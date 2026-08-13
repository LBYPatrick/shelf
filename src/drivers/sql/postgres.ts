import { Pool, type PoolClient, type QueryResult } from 'pg';
import Cursor from 'pg-cursor';
import { capabilities } from '../capabilities';
import { encodeRows, tagFields } from '../transcode';
import type {
  ChangeSet,
  Column,
  ConnectionConfig,
  Cursor as DriverCursor,
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
import { buildChangePreview, buildChangeStatements } from './changes';
import {
  buildOrderBy,
  buildSelectList,
  buildWhere,
  qualify,
  quoteIdentifier,
  type Dialect,
} from './dialect';
import { singleSourceTable, splitStatements } from './statements';

/** Postgres numbers its bind parameters, unlike most other engines. */
const PG_DIALECT: Dialect = {
  quote: '"',
  placeholder: (index) => `$${index}`,
  limitClause: (limit, offset) => `LIMIT ${limit} OFFSET ${offset}`,
};

const PG_CAPABILITIES = capabilities({
  partitions: true,
  // A COUNT(*) on a large Postgres table is a sequential scan over the heap,
  // which is far too slow to run on every page of the grid.
  cheapCount: false,
});

/**
 * PostgreSQL, over `pg`.
 *
 * A pool rather than a single connection, because the interface issues schema
 * lookups while a query is still running and a single connection would
 * serialise them. Manual transactions take a dedicated client out of the pool
 * for the duration, since a transaction that hops between connections is not a
 * transaction.
 */
export class PostgresClient implements DatabaseClient {
  readonly engine = 'postgres' as const;
  readonly capabilities = PG_CAPABILITIES;

  private pool: Pool | null = null;
  /** Clients reserved for a tab's open transaction. */
  private readonly transactions = new Map<string, PoolClient>();

  constructor(private readonly config: ConnectionConfig) {}

  private require(): Pool {
    if (!this.pool) throw new Error('Not connected');
    return this.pool;
  }

  private assertWritable(): void {
    if (this.config.readOnly) throw new Error('This connection is read-only.');
  }

  async connect(signal?: AbortSignal): Promise<void> {
    const { config } = this;

    this.pool = new Pool({
      ...(config.url
        ? { connectionString: config.url }
        : {
            ...(config.socketPath ? { host: config.socketPath } : { host: config.host }),
            ...(config.port ? { port: config.port } : {}),
            ...(config.username ? { user: config.username } : {}),
            ...(config.password ? { password: config.password } : {}),
            ...(config.database ? { database: config.database } : {}),
          }),
      ...(config.ssl?.enabled
        ? { ssl: { rejectUnauthorized: config.ssl.rejectUnauthorized } }
        : {}),
      max: 4,
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 30_000,
      // Timestamps arrive as text and are interpreted by the grid, so a value
      // is never silently shifted into the machine's local timezone.
      application_name: 'Shelf',
    });

    // An unhandled pool error terminates the process by default; surfacing it
    // as a connection failure is what lets the interface offer a reconnect.
    this.pool.on('error', () => undefined);

    signal?.addEventListener('abort', () => void this.pool?.end().catch(() => undefined));

    const client = await this.pool.connect();
    client.release();
  }

  async disconnect(): Promise<void> {
    for (const client of this.transactions.values()) {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
    this.transactions.clear();

    await this.pool?.end().catch(() => undefined);
    this.pool = null;
  }

  private async run<T extends Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
    tabId?: string
  ): Promise<QueryResult<T>> {
    // Work belonging to an open transaction must go down that transaction's
    // own connection, not a fresh one from the pool.
    const reserved = tabId ? this.transactions.get(tabId) : undefined;
    const target = reserved ?? this.require();
    return target.query<T>(sql, params as unknown[]);
  }

  async versionString(): Promise<string> {
    const result = await this.run<{ version: string }>('SHOW server_version');
    return `PostgreSQL ${result.rows[0]?.version ?? 'unknown'}`;
  }

  async ping(): Promise<void> {
    await this.run('SELECT 1');
  }

  async listDatabases(): Promise<readonly string[]> {
    const result = await this.run<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname'
    );
    return result.rows.map((row) => row.datname);
  }

  async listSchemas(): Promise<readonly string[]> {
    const result = await this.run<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace
       WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
       ORDER BY nspname`
    );
    return result.rows.map((row) => row.nspname);
  }

  async listEntities(schema?: string): Promise<readonly Entity[]> {
    const result = await this.run<{
      schema: string;
      name: string;
      kind: string;
      comment: string | null;
    }>(
      `SELECT n.nspname AS schema,
              c.relname AS name,
              c.relkind AS kind,
              obj_description(c.oid) AS comment
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p', 'v', 'm')
          AND n.nspname NOT LIKE 'pg\\_%'
          AND n.nspname <> 'information_schema'
          AND ($1::text IS NULL OR n.nspname = $1)
        ORDER BY n.nspname, c.relname`,
      [schema ?? null]
    );

    const entities: Entity[] = result.rows.map((row) => ({
      name: row.name,
      schema: row.schema,
      kind:
        row.kind === 'v'
          ? ('view' as const)
          : row.kind === 'm'
            ? ('materialized-view' as const)
            : ('table' as const),
      ...(row.comment ? { comment: row.comment } : {}),
    }));

    const routines = await this.run<{ schema: string; name: string; kind: string }>(
      `SELECT n.nspname AS schema, p.proname AS name,
              CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END AS kind
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname NOT LIKE 'pg\\_%'
          AND n.nspname <> 'information_schema'
          AND ($1::text IS NULL OR n.nspname = $1)
        ORDER BY n.nspname, p.proname`,
      [schema ?? null]
    );

    for (const row of routines.rows) {
      entities.push({
        name: row.name,
        schema: row.schema,
        kind: 'routine',
        routineType: row.kind as 'function' | 'procedure',
      });
    }

    return entities;
  }

  async listColumns(entity: EntityRef): Promise<readonly Column[]> {
    const result = await this.run<{
      name: string;
      data_type: string;
      nullable: boolean;
      default_value: string | null;
      is_primary: boolean;
      generated: boolean;
      comment: string | null;
      ordinal: number;
    }>(
      `SELECT a.attname AS name,
              format_type(a.atttypid, a.atttypmod) AS data_type,
              NOT a.attnotnull AS nullable,
              pg_get_expr(d.adbin, d.adrelid) AS default_value,
              COALESCE(pk.is_primary, false) AS is_primary,
              a.attgenerated <> '' AS generated,
              col_description(a.attrelid, a.attnum) AS comment,
              a.attnum AS ordinal
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         LEFT JOIN LATERAL (
              SELECT true AS is_primary
                FROM pg_index i
               WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)
         ) pk ON true
        WHERE c.relname = $1
          AND n.nspname = COALESCE($2, current_schema())
          AND a.attnum > 0
          AND NOT a.attisdropped
        ORDER BY a.attnum`,
      [entity.name, entity.schema ?? null]
    );

    return result.rows.map((row) => ({
      name: row.name,
      dataType: row.data_type,
      nullable: row.nullable,
      ...(row.default_value ? { defaultValue: row.default_value } : {}),
      primaryKey: row.is_primary,
      generated: row.generated,
      ...(row.comment ? { comment: row.comment } : {}),
      ordinal: row.ordinal,
    }));
  }

  async listIndexes(entity: EntityRef): Promise<readonly Index[]> {
    const result = await this.run<{
      name: string;
      columns: string[];
      is_unique: boolean;
      is_primary: boolean;
      method: string;
    }>(
      `SELECT i.relname AS name,
              array_agg(a.attname ORDER BY k.ord) AS columns,
              ix.indisunique AS is_unique,
              ix.indisprimary AS is_primary,
              am.amname AS method
         FROM pg_index ix
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN pg_class t ON t.oid = ix.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_am am ON am.oid = i.relam
         JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
        WHERE t.relname = $1 AND n.nspname = COALESCE($2, current_schema())
        GROUP BY i.relname, ix.indisunique, ix.indisprimary, am.amname
        ORDER BY i.relname`,
      [entity.name, entity.schema ?? null]
    );

    return result.rows.map((row) => ({
      name: row.name,
      columns: row.columns,
      unique: row.is_unique,
      primary: row.is_primary,
      type: row.method,
    }));
  }

  async listRelations(entity: EntityRef): Promise<readonly Relation[]> {
    const result = await this.run<{
      name: string;
      direction: string;
      columns: string[];
      ref_schema: string;
      ref_table: string;
      ref_columns: string[];
      on_update: string;
      on_delete: string;
    }>(
      `WITH target AS (
         SELECT c.oid FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = $1 AND n.nspname = COALESCE($2, current_schema())
       )
       SELECT con.conname AS name,
              CASE WHEN con.conrelid = (SELECT oid FROM target) THEN 'outgoing' ELSE 'incoming' END AS direction,
              (SELECT array_agg(a.attname ORDER BY k.ord)
                 FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS columns,
              rn.nspname AS ref_schema,
              rc.relname AS ref_table,
              (SELECT array_agg(a.attname ORDER BY k.ord)
                 FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) AS ref_columns,
              con.confupdtype::text AS on_update,
              con.confdeltype::text AS on_delete
         FROM pg_constraint con
         JOIN pg_class rc ON rc.oid = con.confrelid
         JOIN pg_namespace rn ON rn.oid = rc.relnamespace
        WHERE con.contype = 'f'
          AND (con.conrelid = (SELECT oid FROM target) OR con.confrelid = (SELECT oid FROM target))`,
      [entity.name, entity.schema ?? null]
    );

    return result.rows.map((row) => ({
      name: row.name,
      direction: row.direction as 'outgoing' | 'incoming',
      columns: row.columns ?? [],
      referencedTable: { name: row.ref_table, schema: row.ref_schema },
      referencedColumns: row.ref_columns ?? [],
      onUpdate: row.on_update,
      onDelete: row.on_delete,
    }));
  }

  async listTriggers(entity: EntityRef): Promise<readonly Trigger[]> {
    const result = await this.run<{
      name: string;
      timing: string;
      event: string;
      statement: string;
    }>(
      `SELECT trigger_name AS name, action_timing AS timing,
              event_manipulation AS event, action_statement AS statement
         FROM information_schema.triggers
        WHERE event_object_table = $1
          AND event_object_schema = COALESCE($2, current_schema())`,
      [entity.name, entity.schema ?? null]
    );
    return result.rows;
  }

  async listPartitions(entity: EntityRef): Promise<readonly Partition[]> {
    const result = await this.run<{ name: string; expression: string }>(
      `SELECT child.relname AS name,
              pg_get_expr(child.relpartbound, child.oid) AS expression
         FROM pg_inherits
         JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
         JOIN pg_class child ON child.oid = pg_inherits.inhrelid
         JOIN pg_namespace n ON n.oid = parent.relnamespace
        WHERE parent.relname = $1 AND n.nspname = COALESCE($2, current_schema())
        ORDER BY child.relname`,
      [entity.name, entity.schema ?? null]
    );
    return result.rows;
  }

  async getProperties(entity: EntityRef): Promise<EntityProperties> {
    const result = await this.run<{
      row_estimate: string;
      data_size: string;
      index_size: string;
      comment: string | null;
    }>(
      `SELECT c.reltuples::bigint::text AS row_estimate,
              pg_table_size(c.oid)::text AS data_size,
              pg_indexes_size(c.oid)::text AS index_size,
              obj_description(c.oid) AS comment
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = $1 AND n.nspname = COALESCE($2, current_schema())`,
      [entity.name, entity.schema ?? null]
    );

    const row = result.rows[0];
    if (!row) return {};

    const estimate = Number(row.row_estimate);
    return {
      // A negative estimate means the table has never been analysed, in which
      // case reporting it would be worse than reporting nothing.
      ...(estimate >= 0 ? { rowCount: estimate } : {}),
      dataSizeBytes: Number(row.data_size),
      indexSizeBytes: Number(row.index_size),
      ...(row.comment ? { comment: row.comment } : {}),
    };
  }

  private buildSelect(request: SelectRequest): { sql: string; params: unknown[] } {
    const where = buildWhere(request.filters, PG_DIALECT);
    return {
      sql:
        `SELECT ${buildSelectList(request.select, PG_DIALECT)} ` +
        `FROM ${qualify(request.entity, PG_DIALECT)}` +
        where.sql +
        buildOrderBy(request.orderBy, PG_DIALECT) +
        ` ${PG_DIALECT.limitClause(request.limit, request.offset)}`,
      params: [...where.params],
    };
  }

  async selectTop(request: SelectRequest): Promise<Page> {
    const { sql, params } = this.buildSelect(request);
    const result = await this.run<Record<string, unknown>>(sql, params);
    const rows = encodeRows(result.rows);

    return {
      rows,
      fields: tagFields(
        result.fields.map((field) => ({ name: field.name })),
        rows
      ),
    };
  }

  async selectTopSql(request: SelectRequest): Promise<string> {
    return this.buildSelect(request).sql;
  }

  async count(entity: EntityRef, filters?: Filters): Promise<number> {
    const where = buildWhere(filters, PG_DIALECT);
    const result = await this.run<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ${qualify(entity, PG_DIALECT)}${where.sql}`,
      where.params
    );
    return Number(result.rows[0]?.n ?? 0);
  }

  async query(
    text: string,
    options: QueryOptions,
    signal?: AbortSignal
  ): Promise<readonly ResultSet[]> {
    const statements = splitStatements(text);
    const results: ResultSet[] = [];

    // A cancel has to reach the server, so the query runs on a client we can
    // identify and then kill by backend pid from a second connection.
    const client = options.tabId
      ? (this.transactions.get(options.tabId) ?? (await this.require().connect()))
      : await this.require().connect();
    const borrowed = !options.tabId || !this.transactions.has(options.tabId);

    const pidResult = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    const pid = pidResult.rows[0]?.pid;

    const cancel = () => {
      if (pid === undefined) return;
      void this.require()
        .query('SELECT pg_cancel_backend($1)', [pid])
        .catch(() => undefined);
    };
    signal?.addEventListener('abort', cancel);

    try {
      for (const statement of statements) {
        if (signal?.aborted) break;

        const started = performance.now();
        const result = await client.query<Record<string, unknown>>(statement);
        const durationMs = performance.now() - started;

        const all = result.rows ?? [];
        const truncated = all.length > options.maxRows;
        const rows = encodeRows(truncated ? all.slice(0, options.maxRows) : all);

        results.push({
          fields: tagFields(
            (result.fields ?? []).map((field) => ({ name: field.name })),
            rows
          ),
          rows,
          truncated,
          rowCount: all.length,
          ...(typeof result.rowCount === 'number' && all.length === 0
            ? { affectedRows: result.rowCount }
            : {}),
          statement,
          durationMs,
        });
      }
    } finally {
      signal?.removeEventListener('abort', cancel);
      if (borrowed) client.release();
    }

    return results;
  }

  async stream(request: StreamRequest): Promise<DriverCursor> {
    const client = await this.require().connect();

    const sql = request.query
      ? request.query
      : this.buildSelect({
          entity: request.entity!,
          offset: 0,
          limit: Number.MAX_SAFE_INTEGER,
          ...(request.orderBy ? { orderBy: request.orderBy } : {}),
          ...(request.filters ? { filters: request.filters } : {}),
        }).sql;

    const params = request.query ? [] : buildWhere(request.filters, PG_DIALECT).params;
    const cursor = client.query(new Cursor(sql, params as unknown[]));

    let fields: Field[] = [];
    let closed = false;

    return {
      get fields() {
        return fields;
      },
      async read() {
        if (closed) return [];
        const batch = await cursor.read(request.chunkSize);
        if (fields.length === 0) {
          fields = (
            (cursor as unknown as { _result?: { fields?: { name: string }[] } })._result
              ?.fields ?? []
          ).map((field) => ({ name: field.name }));
        }
        return encodeRows(batch as Record<string, unknown>[]);
      },
      async close() {
        if (closed) return;
        closed = true;
        await new Promise<void>((resolve) => cursor.close(() => resolve()));
        client.release();
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

    const source = singleSourceTable(text);
    if (!source) {
      return fields.map((field) => ({
        field: field.name,
        editable: false,
        reason: 'no-linked-table' as const,
      }));
    }

    const columns = await this.listColumns(source);
    const byName = new Map(columns.map((column) => [column.name, column]));
    const hasPrimaryKey = columns.some((column) => column.primaryKey);

    return fields.map((field) => {
      const column = byName.get(field.name);
      if (!column) {
        return { field: field.name, editable: false, reason: 'ambiguous-mapping' as const };
      }
      if (column.generated) {
        return { field: field.name, editable: false, reason: 'computed-column' as const };
      }
      if (!hasPrimaryKey) {
        return { field: field.name, editable: false, reason: 'missing-primary-key' as const };
      }
      return {
        field: field.name,
        editable: true,
        source: { entity: source, column: column.name },
      };
    });
  }

  async applyChanges(changes: ChangeSet): Promise<void> {
    this.assertWritable();

    const statements = buildChangeStatements(changes, PG_DIALECT);
    if (statements.length === 0) return;

    const client = await this.require().connect();
    try {
      // One transaction for the whole set: half-applied grid edits would leave
      // the data in a state the user never asked for.
      await client.query('BEGIN');
      for (const { sql, params } of statements) {
        await client.query(sql, params as unknown[]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async applyChangesSql(changes: ChangeSet): Promise<string> {
    return buildChangePreview(changes, PG_DIALECT);
  }

  async beginTransaction(tabId: string): Promise<void> {
    this.assertWritable();
    if (this.transactions.has(tabId)) return;

    const client = await this.require().connect();
    await client.query('BEGIN');
    this.transactions.set(tabId, client);
  }

  async commitTransaction(tabId: string): Promise<void> {
    const client = this.transactions.get(tabId);
    if (!client) return;
    this.transactions.delete(tabId);
    try {
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  }

  async rollbackTransaction(tabId: string): Promise<void> {
    const client = this.transactions.get(tabId);
    if (!client) return;
    this.transactions.delete(tabId);
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }

  quoteIdentifier(value: string): string {
    return quoteIdentifier(value, PG_DIALECT);
  }
}
