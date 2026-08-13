import { auth, Client, types } from 'cassandra-driver';
import { capabilities } from '../capabilities';
import { encodeRows, tagFields } from '../transcode';
import type {
  ChangeSet,
  Column,
  ConnectionConfig,
  Cursor,
  DatabaseClient,
  Entity,
  EntityProperties,
  EntityRef,
  Field,
  FieldEditability,
  Filters,
  Index,
  Page,
  Partition,
  QueryOptions,
  Relation,
  ResultSet,
  SelectRequest,
  StreamRequest,
  Trigger,
} from '../types';
import {
  buildOrderBy,
  buildSelectList,
  buildWhere,
  quoteIdentifier,
  type Dialect,
} from '../sql/dialect';
import { splitStatements } from '../sql/statements';

const CQL_DIALECT: Dialect = {
  quote: '"',
  placeholder: () => '?',
  limitClause: (limit) => `LIMIT ${limit}`,
};

/**
 * Scylla speaks CQL, which looks like SQL but is not.
 *
 * The differences that matter here are all consequences of it being a
 * distributed store: there is no OFFSET, because paging is by token rather than
 * by position; sorting only works on clustering columns; a COUNT(*) is a full
 * cluster scan; and there are no joins, so no foreign keys to show. Each of
 * those is declared rather than discovered by failing.
 */
const SCYLLA_CAPABILITIES = capabilities({
  queryLanguage: 'cql',
  // A keyspace fills the role of a database, and there are no schemas below it.
  schemas: false,
  transactions: false,
  relations: false,
  triggers: false,
  routines: false,
  partitions: false,
  ddl: true,
  sortPushdown: 'partial',
  filterPushdown: 'partial',
  cheapCount: false,
  nouns: { database: 'keyspace', entity: 'table', row: 'row', column: 'column' },
});

export class ScyllaClient implements DatabaseClient {
  readonly engine = 'scylla' as const;
  readonly capabilities = SCYLLA_CAPABILITIES;

  private client: Client | null = null;
  /** Page state per select, so paging forward does not rescan from the start. */
  private readonly pageStates = new Map<string, (string | undefined)[]>();

  constructor(private readonly config: ConnectionConfig) {}

  private require(): Client {
    if (!this.client) throw new Error('Not connected');
    return this.client;
  }

  private assertWritable(): void {
    if (this.config.readOnly) throw new Error('This connection is read-only.');
  }

  private get keyspace(): string | undefined {
    return this.config.database || undefined;
  }

  async connect(): Promise<void> {
    const { config } = this;
    const localDataCenter = String(config.options?.['localDataCenter'] ?? 'datacenter1');

    this.client = new Client({
      contactPoints: [`${config.host ?? 'localhost'}:${config.port ?? 9042}`],
      localDataCenter,
      ...(this.keyspace ? { keyspace: this.keyspace } : {}),
      ...(config.username
        ? {
            authProvider: new auth.PlainTextAuthProvider(
              config.username,
              config.password ?? ''
            ),
          }
        : {}),
      ...(config.ssl?.enabled
        ? { sslOptions: { rejectUnauthorized: config.ssl.rejectUnauthorized } }
        : {}),
      socketOptions: { connectTimeout: 15_000 },
    });

    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client?.shutdown().catch(() => undefined);
    this.client = null;
    this.pageStates.clear();
  }

  async versionString(): Promise<string> {
    const result = await this.require().execute('SELECT release_version FROM system.local');
    return `Scylla/Cassandra ${result.rows?.[0]?.['release_version'] ?? 'unknown'}`;
  }

  async ping(): Promise<void> {
    await this.require().execute('SELECT key FROM system.local');
  }

  async listDatabases(): Promise<readonly string[]> {
    const result = await this.require().execute(
      'SELECT keyspace_name FROM system_schema.keyspaces'
    );
    return result.rows
      .map((row) => String(row['keyspace_name']))
      .filter((name) => !name.startsWith('system'))
      .sort();
  }

  async listSchemas(): Promise<readonly string[]> {
    return [];
  }

  async listEntities(): Promise<readonly Entity[]> {
    const client = this.require();

    const tables = await client.execute(
      'SELECT table_name FROM system_schema.tables WHERE keyspace_name = ?',
      [this.keyspace],
      { prepare: true }
    );

    const views = await client.execute(
      'SELECT view_name FROM system_schema.views WHERE keyspace_name = ?',
      [this.keyspace],
      { prepare: true }
    );

    return [
      ...tables.rows.map((row) => ({
        name: String(row['table_name']),
        kind: 'table' as const,
      })),
      ...views.rows.map((row) => ({
        name: String(row['view_name']),
        kind: 'materialized-view' as const,
      })),
    ].sort((a, b) => a.name.localeCompare(b.name));
  }

  async listColumns(entity: EntityRef): Promise<readonly Column[]> {
    const result = await this.require().execute(
      `SELECT column_name, type, kind, position
         FROM system_schema.columns
        WHERE keyspace_name = ? AND table_name = ?`,
      [this.keyspace, entity.name],
      { prepare: true }
    );

    return result.rows
      .map((row) => ({
        name: String(row['column_name']),
        dataType: String(row['type']),
        // Partition and clustering columns are the key; nothing else can be
        // null-constrained in CQL.
        nullable: String(row['kind']) === 'regular',
        primaryKey: ['partition_key', 'clustering'].includes(String(row['kind'])),
        ordinal: Number(row['position'] ?? 0),
      }))
      .sort((a, b) =>
        a.primaryKey === b.primaryKey ? a.ordinal - b.ordinal : a.primaryKey ? -1 : 1
      )
      .map((column, index) => ({ ...column, ordinal: index }));
  }

  async listIndexes(entity: EntityRef): Promise<readonly Index[]> {
    const result = await this.require().execute(
      `SELECT index_name, options FROM system_schema.indexes
        WHERE keyspace_name = ? AND table_name = ?`,
      [this.keyspace, entity.name],
      { prepare: true }
    );

    return result.rows.map((row) => {
      const options = (row['options'] ?? {}) as Record<string, string>;
      return {
        name: String(row['index_name']),
        columns: options['target'] ? [options['target']] : [],
        unique: false,
        primary: false,
      };
    });
  }

  async listRelations(): Promise<readonly Relation[]> {
    return [];
  }

  async listTriggers(): Promise<readonly Trigger[]> {
    return [];
  }

  async listPartitions(): Promise<readonly Partition[]> {
    return [];
  }

  async getProperties(): Promise<EntityProperties> {
    // Counting rows means a full cluster scan, which is not something to do
    // automatically on opening a table.
    return {};
  }

  /**
   * CQL has no OFFSET. Paging is by opaque page state, so each page forward is
   * remembered and paging backwards replays from a state we already hold.
   */
  private pageKey(entity: EntityRef, filters?: Filters): string {
    return `${entity.name}:${JSON.stringify(filters ?? null)}`;
  }

  async selectTop(request: SelectRequest): Promise<Page> {
    const client = this.require();
    const where = buildWhere(request.filters, CQL_DIALECT);

    // Filtering on a non-key column requires an explicit opt-in, because it is
    // a full scan. Saying so is better than the server's bare error.
    const allowFiltering = where.sql ? ' ALLOW FILTERING' : '';

    const cql =
      `SELECT ${buildSelectList(request.select, CQL_DIALECT)} ` +
      `FROM ${quoteIdentifier(request.entity.name, CQL_DIALECT)}` +
      where.sql +
      buildOrderBy(request.orderBy, CQL_DIALECT) +
      allowFiltering;

    const key = this.pageKey(request.entity, request.filters);
    const states = this.pageStates.get(key) ?? [undefined];
    const pageIndex = Math.floor(request.offset / Math.max(request.limit, 1));

    const result = await client.execute(cql, where.params as unknown[], {
      prepare: true,
      fetchSize: request.limit,
      ...(states[pageIndex] ? { pageState: states[pageIndex] } : {}),
    });

    // Remember where the next page starts so forward paging stays O(1).
    const next = [...states];
    next[pageIndex + 1] = result.pageState;
    this.pageStates.set(key, next);

    const rows = encodeRows((result.rows ?? []).map((row) => normalise(row)));

    return {
      rows,
      fields: tagFields(
        (result.columns ?? []).map((column) => ({ name: column.name })),
        rows
      ),
    };
  }

  async selectTopSql(request: SelectRequest): Promise<string> {
    const where = buildWhere(request.filters, CQL_DIALECT);
    return (
      `SELECT ${buildSelectList(request.select, CQL_DIALECT)} ` +
      `FROM ${quoteIdentifier(request.entity.name, CQL_DIALECT)}` +
      where.sql +
      buildOrderBy(request.orderBy, CQL_DIALECT) +
      ` LIMIT ${request.limit}` +
      (where.sql ? ' ALLOW FILTERING' : '')
    );
  }

  async count(entity: EntityRef, filters?: Filters): Promise<number> {
    const where = buildWhere(filters, CQL_DIALECT);
    const result = await this.require().execute(
      `SELECT COUNT(*) AS n FROM ${quoteIdentifier(entity.name, CQL_DIALECT)}${where.sql}` +
        (where.sql ? ' ALLOW FILTERING' : ''),
      where.params as unknown[],
      { prepare: true }
    );
    return Number(result.rows?.[0]?.['n'] ?? 0);
  }

  async query(text: string, options: QueryOptions): Promise<readonly ResultSet[]> {
    const client = this.require();
    const results: ResultSet[] = [];

    for (const statement of splitStatements(text)) {
      if (this.config.readOnly && !/^\s*select\b/i.test(statement)) {
        throw new Error('This connection is read-only.');
      }

      const started = performance.now();
      const result = await client.execute(statement, [], {
        prepare: true,
        fetchSize: options.maxRows,
      });
      const durationMs = performance.now() - started;

      // CREATE, DROP and USE come back with no `rows` property at all rather
      // than an empty one, so this cannot assume it is an array.
      const rows = encodeRows((result.rows ?? []).map((row) => normalise(row)));

      results.push({
        fields: tagFields(
          (result.columns ?? []).map((column) => ({ name: column.name })),
          rows
        ),
        rows,
        // A page state left over means the server has more to give.
        truncated: Boolean(result.pageState),
        rowCount: rows.length,
        statement,
        durationMs,
      });
    }

    return results;
  }

  async stream(request: StreamRequest): Promise<Cursor> {
    const client = this.require();
    const where = buildWhere(request.filters, CQL_DIALECT);

    const cql = request.query
      ? request.query
      : `SELECT * FROM ${quoteIdentifier(request.entity!.name, CQL_DIALECT)}${where.sql}` +
        (where.sql ? ' ALLOW FILTERING' : '');

    let pageState: string | undefined;
    let fields: Field[] = [];
    let done = false;

    return {
      get fields() {
        return fields;
      },
      async read() {
        if (done) return [];

        const result = await client.execute(cql, where.params as unknown[], {
          prepare: true,
          fetchSize: request.chunkSize,
          ...(pageState ? { pageState } : {}),
        });

        pageState = result.pageState;
        if (!pageState) done = true;
        if (fields.length === 0) {
          fields = (result.columns ?? []).map((column) => ({ name: column.name }));
        }

        return encodeRows((result.rows ?? []).map((row) => normalise(row)));
      },
      async close() {
        done = true;
      },
    };
  }

  async resolveEditability(
    text: string,
    fields: readonly Field[]
  ): Promise<readonly FieldEditability[]> {
    if (this.config.readOnly) {
      return fields.map((field) => ({
        field: field.name,
        editable: false,
        reason: 'read-only-connection' as const,
      }));
    }

    const table = /\bfrom\s+"?([\w$]+)"?/i.exec(text)?.[1];
    if (!table) {
      return fields.map((field) => ({
        field: field.name,
        editable: false,
        reason: 'no-linked-table' as const,
      }));
    }

    const columns = await this.listColumns({ name: table });
    const keys = new Set(columns.filter((column) => column.primaryKey).map((c) => c.name));

    return fields.map((field) => {
      // A key column cannot be updated in CQL — changing it means writing a new
      // row and deleting the old one, which is not what editing a cell means.
      if (keys.has(field.name)) {
        return { field: field.name, editable: false, reason: 'computed-column' as const };
      }
      if (keys.size === 0) {
        return { field: field.name, editable: false, reason: 'missing-primary-key' as const };
      }
      return {
        field: field.name,
        editable: true,
        source: { entity: { name: table }, column: field.name },
      };
    });
  }

  async applyChanges(changes: ChangeSet): Promise<void> {
    this.assertWritable();
    const client = this.require();

    // CQL has no multi-statement transaction; a logged batch is the closest
    // equivalent and at least makes the set atomic per partition.
    const queries: { query: string; params: unknown[] }[] = [];

    for (const insert of changes.inserts) {
      const columns = Object.keys(insert.values);
      queries.push({
        query:
          `INSERT INTO ${quoteIdentifier(insert.entity.name, CQL_DIALECT)} ` +
          `(${columns.map((c) => quoteIdentifier(c, CQL_DIALECT)).join(', ')}) ` +
          `VALUES (${columns.map(() => '?').join(', ')})`,
        params: columns.map((column) => unwrap(insert.values[column])),
      });
    }

    for (const update of changes.updates) {
      queries.push({
        query:
          `UPDATE ${quoteIdentifier(update.entity.name, CQL_DIALECT)} ` +
          `SET ${quoteIdentifier(update.column, CQL_DIALECT)} = ? WHERE ` +
          update.primaryKeys
            .map((key) => `${quoteIdentifier(key.column, CQL_DIALECT)} = ?`)
            .join(' AND '),
        params: [unwrap(update.value), ...update.primaryKeys.map((key) => unwrap(key.value))],
      });
    }

    for (const remove of changes.deletes) {
      queries.push({
        query:
          `DELETE FROM ${quoteIdentifier(remove.entity.name, CQL_DIALECT)} WHERE ` +
          remove.primaryKeys
            .map((key) => `${quoteIdentifier(key.column, CQL_DIALECT)} = ?`)
            .join(' AND '),
        params: remove.primaryKeys.map((key) => unwrap(key.value)),
      });
    }

    if (queries.length === 0) return;
    await client.batch(queries, { prepare: true, logged: true });
  }

  async applyChangesSql(changes: ChangeSet): Promise<string> {
    const lines: string[] = ['BEGIN BATCH'];

    for (const insert of changes.inserts) {
      const columns = Object.keys(insert.values);
      lines.push(
        `  INSERT INTO ${insert.entity.name} (${columns.join(', ')}) ` +
          `VALUES (${columns.map((c) => literal(insert.values[c])).join(', ')});`
      );
    }
    for (const update of changes.updates) {
      lines.push(
        `  UPDATE ${update.entity.name} SET ${update.column} = ${literal(update.value)} ` +
          `WHERE ${update.primaryKeys.map((k) => `${k.column} = ${literal(k.value)}`).join(' AND ')};`
      );
    }
    for (const remove of changes.deletes) {
      lines.push(
        `  DELETE FROM ${remove.entity.name} ` +
          `WHERE ${remove.primaryKeys.map((k) => `${k.column} = ${literal(k.value)}`).join(' AND ')};`
      );
    }

    lines.push('APPLY BATCH;');
    return lines.join('\n');
  }

  async beginTransaction(): Promise<void> {
    throw new Error('CQL has no interactive transactions; edits are applied as a batch.');
  }

  async commitTransaction(): Promise<void> {
    throw new Error('CQL has no interactive transactions; edits are applied as a batch.');
  }

  async rollbackTransaction(): Promise<void> {
    throw new Error('CQL has no interactive transactions; edits are applied as a batch.');
  }

  quoteIdentifier(value: string): string {
    return quoteIdentifier(value, CQL_DIALECT);
  }
}

/**
 * The driver returns its own wrappers for several CQL types. They are converted
 * to plain values here so the grid does not have to know about any of them.
 */
function normalise(row: types.Row): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(row)) {
    const value = row[key];

    if (value instanceof types.Long) result[key] = value.toString();
    else if (value instanceof types.Uuid || value instanceof types.TimeUuid) {
      result[key] = value.toString();
    } else if (value instanceof types.LocalDate || value instanceof types.LocalTime) {
      result[key] = value.toString();
    } else if (value instanceof types.InetAddress) result[key] = value.toString();
    else if (value instanceof types.BigDecimal) result[key] = value.toString();
    else result[key] = value;
  }

  return result;
}

function unwrap(value: unknown): unknown {
  if (value && typeof value === 'object' && '$' in value) {
    return (value as { data: unknown }).data;
  }
  return value;
}

function literal(value: unknown): string {
  const raw = unwrap(value);
  if (raw === null || raw === undefined) return 'null';
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return `'${String(raw).split("'").join("''")}'`;
}
