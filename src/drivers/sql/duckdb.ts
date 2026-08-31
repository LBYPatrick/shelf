import { limitStatement } from '@shared/rowLimit';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { capabilities } from '../capabilities';
import { encodeRows, tagFields } from '../transcode';
import type {
  ChangeSet,
  Column,
  ConnectionConfig,
  ContainerProperties,
  ContainerRef,
  Cursor,
  DatabaseClient,
  Entity,
  EntityProperties,
  EntityRef,
  Field,
  FieldEditability,
  Filters,
  Index,
  ListEntitiesOptions,
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

const DUCKDB_DIALECT: Dialect = {
  quote: '"',
  placeholder: (index) => `$${index}`,
  limitClause: (limit, offset) => `LIMIT ${limit} OFFSET ${offset}`,
};

/**
 * DuckDB is columnar and local, which changes what is cheap: a COUNT(*) is a
 * fast scan over compressed columns rather than a trip to a server, so the
 * pager can offer a last page. It has no triggers and no server to tunnel to.
 */
/** The schemas DuckDB carries for Postgres compatibility, not for the reader. */
const BUILT_IN_SCHEMAS = new Set(['information_schema', 'pg_catalog']);

const DUCKDB_CAPABILITIES = capabilities({
  triggers: false,
  cheapCount: true,
  sshTunnel: false,
  multipleDatabases: false,
  builtInEntities: true,
});

/**
 * DuckDB, over the official Node API.
 *
 * The driver returns values through its own typed wrappers rather than plain
 * JavaScript, so results are converted once on the way out — `toJS` on a row
 * would otherwise leave DECIMALs and INTERVALs as objects the grid cannot read.
 */
export class DuckdbClient implements DatabaseClient {
  readonly engine = 'duckdb' as const;
  readonly capabilities = DUCKDB_CAPABILITIES;

  private instance: DuckDBInstance | null = null;
  private connection: DuckDBConnection | null = null;
  private readonly openTransactions = new Set<string>();

  constructor(private readonly config: ConnectionConfig) {}

  private require(): DuckDBConnection {
    if (!this.connection) throw new Error('Not connected');
    return this.connection;
  }

  private assertWritable(): void {
    if (this.config.readOnly) throw new Error('This connection is read-only.');
  }

  async connect(): Promise<void> {
    const path = this.config.filePath ?? ':memory:';

    this.instance = await DuckDBInstance.create(path, {
      access_mode: this.config.readOnly ? 'READ_ONLY' : 'READ_WRITE',
    });
    this.connection = await this.instance.connect();
  }

  async disconnect(): Promise<void> {
    this.connection?.closeSync();
    this.connection = null;
    this.instance = null;
    this.openTransactions.clear();
  }

  /** Runs a statement and converts the result into plain rows and field names. */
  private async run(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<{ rows: Record<string, unknown>[]; fields: string[] }> {
    const reader =
      params.length > 0
        ? await this.require().runAndReadAll(sql, params as never[])
        : await this.require().runAndReadAll(sql);

    return {
      rows: reader.getRowObjectsJS() as Record<string, unknown>[],
      fields: reader.columnNames(),
    };
  }

  async versionString(): Promise<string> {
    const { rows } = await this.run('SELECT version() AS v');
    return `DuckDB ${(rows[0]?.['v'] as string) ?? 'unknown'}`;
  }

  async ping(): Promise<void> {
    await this.run('SELECT 1');
  }

  async listDatabases(): Promise<readonly string[]> {
    return [this.config.filePath ?? ':memory:'];
  }

  async listSchemas(): Promise<readonly string[]> {
    const { rows } = await this.run(
      `SELECT schema_name AS schema_name FROM information_schema.schemata
        WHERE schema_name NOT IN ('information_schema', 'pg_catalog')
        ORDER BY schema_name`
    );
    return rows.map((row) => String(row['schema_name']));
  }

  async listEntities(
    schema?: string,
    options?: ListEntitiesOptions
  ): Promise<readonly Entity[]> {
    // The two catalogue schemas DuckDB carries for compatibility. Excluded in
    // the query rather than in the mapping, so what is not shown is also not
    // fetched.
    const { rows } = await this.run(
      `SELECT table_schema AS table_schema, table_name AS table_name,
              table_type AS table_type
         FROM information_schema.tables
        WHERE ($2 OR table_schema NOT IN ('information_schema', 'pg_catalog'))
          AND ($1 IS NULL OR table_schema = $1)
        ORDER BY table_schema, table_name`,
      [schema ?? null, options?.builtIns === true]
    );

    return rows.map((row) => {
      const inSchema = String(row['table_schema']);
      return {
        name: String(row['table_name']),
        schema: inSchema,
        kind: String(row['table_type']) === 'VIEW' ? ('view' as const) : ('table' as const),
        ...(BUILT_IN_SCHEMAS.has(inSchema) ? { builtIn: true } : {}),
      };
    });
  }

  async listColumns(entity: EntityRef): Promise<readonly Column[]> {
    const { rows } = await this.run(
      // Aliased explicitly rather than relying on how the engine cases
      // unaliased information_schema columns.
      `SELECT column_name AS column_name, data_type AS data_type,
              is_nullable AS is_nullable, column_default AS column_default,
              ordinal_position AS ordinal_position
         FROM information_schema.columns
        WHERE table_name = $1 AND ($2 IS NULL OR table_schema = $2)
        ORDER BY ordinal_position`,
      [entity.name, entity.schema ?? null]
    );

    // DuckDB does not expose primary keys through information_schema, so they
    // come from its own constraint catalogue.
    const keys = await this.primaryKeyColumns(entity);

    return rows.map((row) => ({
      name: String(row['column_name']),
      dataType: String(row['data_type']),
      nullable: String(row['is_nullable']) === 'YES',
      ...(row['column_default'] !== null && row['column_default'] !== undefined
        ? { defaultValue: String(row['column_default']) }
        : {}),
      primaryKey: keys.has(String(row['column_name'])),
      ordinal: Number(row['ordinal_position']),
    }));
  }

  private async primaryKeyColumns(entity: EntityRef): Promise<Set<string>> {
    try {
      const { rows } = await this.run(
        `SELECT constraint_column_names
           FROM duckdb_constraints()
          WHERE table_name = $1 AND constraint_type = 'PRIMARY KEY'
            AND ($2 IS NULL OR schema_name = $2)`,
        [entity.name, entity.schema ?? null]
      );

      const names = rows.flatMap((row) => (row['constraint_column_names'] as string[]) ?? []);
      return new Set(names);
    } catch {
      // Older builds do not expose duckdb_constraints(); editing is then
      // refused for want of a key rather than guessed at.
      return new Set();
    }
  }

  async listIndexes(entity: EntityRef): Promise<readonly Index[]> {
    const { rows } = await this.run(
      `SELECT index_name, is_unique, sql
         FROM duckdb_indexes()
        WHERE table_name = $1 AND ($2 IS NULL OR schema_name = $2)`,
      [entity.name, entity.schema ?? null]
    );

    return rows.map((row) => ({
      name: String(row['index_name']),
      // The catalogue does not decompose the key, so the expression is parsed
      // out of the statement that created it.
      columns: columnsFromIndexSql(String(row['sql'] ?? '')),
      unique: Boolean(row['is_unique']),
      primary: false,
    }));
  }

  async listRelations(entity: EntityRef): Promise<readonly Relation[]> {
    const { rows } = await this.run(
      `SELECT table_name, schema_name, constraint_column_names, constraint_text
         FROM duckdb_constraints()
        WHERE constraint_type = 'FOREIGN KEY'`
    );

    const relations: Relation[] = [];

    for (const row of rows) {
      const table = String(row['table_name']);
      const text = String(row['constraint_text'] ?? '');
      const referenced = /REFERENCES\s+([\w".]+)/i.exec(text)?.[1]?.replace(/"/g, '');
      const columns = (row['constraint_column_names'] as string[]) ?? [];

      if (table === entity.name) {
        relations.push({
          name: `fk_${table}_${columns.join('_')}`,
          direction: 'outgoing',
          columns,
          referencedTable: { name: referenced ?? '' },
          referencedColumns: [],
        });
      } else if (referenced === entity.name) {
        relations.push({
          name: `fk_${table}_${columns.join('_')}`,
          direction: 'incoming',
          columns: [],
          referencedTable: { name: table, schema: String(row['schema_name']) },
          referencedColumns: columns,
        });
      }
    }

    return relations;
  }

  async listTriggers(): Promise<readonly Trigger[]> {
    return [];
  }

  async listPartitions(): Promise<readonly Partition[]> {
    return [];
  }

  async getProperties(entity: EntityRef): Promise<EntityProperties> {
    return { rowCount: await this.count(entity) };
  }

  async getContainerProperties(target: ContainerRef): Promise<ContainerProperties> {
    const { rows } = await this.run(
      `SELECT table_type AS kind, count(*) AS n
         FROM information_schema.tables
        WHERE ?::VARCHAR IS NULL OR table_schema = ?
        GROUP BY 1`,
      target.kind === 'schema' ? [target.name, target.name] : [null, null]
    );

    const countOf = (kind: string) =>
      Number(rows.find((row) => String(row['kind']) === kind)?.['n'] ?? 0);

    return {
      facts: [
        { key: 'file', text: this.config.filePath ?? ':memory:' },
        { key: 'tables', count: countOf('BASE TABLE') },
        { key: 'views', count: countOf('VIEW') },
      ],
    };
  }

  private buildSelect(request: SelectRequest): { sql: string; params: unknown[] } {
    const where = buildWhere(request.filters, DUCKDB_DIALECT);
    return {
      sql:
        `SELECT ${buildSelectList(request.select, DUCKDB_DIALECT)} ` +
        `FROM ${qualify(request.entity, DUCKDB_DIALECT)}` +
        where.sql +
        buildOrderBy(request.orderBy, DUCKDB_DIALECT) +
        ` ${DUCKDB_DIALECT.limitClause(request.limit, request.offset)}`,
      params: [...where.params],
    };
  }

  async selectTop(request: SelectRequest): Promise<Page> {
    const { sql, params } = this.buildSelect(request);
    const { rows, fields } = await this.run(sql, params);
    const encoded = encodeRows(rows);

    return {
      rows: encoded,
      fields: tagFields(
        fields.map((name) => ({ name })),
        encoded
      ),
      totalRowCount: await this.count(request.entity, request.filters),
    };
  }

  async selectTopSql(request: SelectRequest): Promise<string> {
    return this.buildSelect(request).sql;
  }

  async count(entity: EntityRef, filters?: Filters): Promise<number> {
    const where = buildWhere(filters, DUCKDB_DIALECT);
    const { rows } = await this.run(
      `SELECT COUNT(*)::BIGINT AS n FROM ${qualify(entity, DUCKDB_DIALECT)}${where.sql}`,
      where.params
    );
    return Number(rows[0]?.['n'] ?? 0);
  }

  async query(
    text: string,
    options: QueryOptions,
    signal?: AbortSignal
  ): Promise<readonly ResultSet[]> {
    const results: ResultSet[] = [];

    for (const statement of splitStatements(text)) {
      if (signal?.aborted) break;
      if (/^\s*(insert|update|delete|create|drop|alter|copy)/i.test(statement)) {
        this.assertWritable();
      }

      const started = performance.now();
      const { rows, fields } = await this.run(limitStatement(statement, options.maxRows));
      const durationMs = performance.now() - started;

      const truncated = rows.length > options.maxRows;
      const encoded = encodeRows(truncated ? rows.slice(0, options.maxRows) : rows);

      results.push({
        fields: tagFields(
          fields.map((name) => ({ name })),
          encoded
        ),
        rows: encoded,
        truncated,
        rowCount: encoded.length,
        statement,
        durationMs,
      });
    }

    return results;
  }

  async stream(request: StreamRequest): Promise<Cursor> {
    const sql = request.query
      ? request.query
      : this.buildSelect({
          entity: request.entity!,
          offset: 0,
          limit: Number.MAX_SAFE_INTEGER,
          ...(request.orderBy ? { orderBy: request.orderBy } : {}),
          ...(request.filters ? { filters: request.filters } : {}),
        }).sql;

    const params = request.query ? [] : buildWhere(request.filters, DUCKDB_DIALECT).params;

    const reader =
      params.length > 0
        ? await this.require().streamAndRead(sql, params as never[])
        : await this.require().streamAndRead(sql);

    const fields: Field[] = reader.columnNames().map((name) => ({ name }));
    let done = false;

    return {
      fields,
      async read() {
        if (done) return [];

        await reader.readUntil(reader.currentRowCount + request.chunkSize);
        const all = reader.getRowObjectsJS() as Record<string, unknown>[];

        // The reader accumulates, so only the newly-read tail is returned.
        const chunk = all.slice(-request.chunkSize);
        if (reader.done) done = true;
        return encodeRows(chunk);
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
    const hasKey = columns.some((column) => column.primaryKey);

    return fields.map((field) => {
      const column = byName.get(field.name);
      if (!column) {
        return { field: field.name, editable: false, reason: 'ambiguous-mapping' as const };
      }
      if (!hasKey) {
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

    const statements = buildChangeStatements(changes, DUCKDB_DIALECT);
    if (statements.length === 0) return;

    const connection = this.require();
    await connection.run('BEGIN TRANSACTION');
    try {
      for (const { sql, params } of statements) {
        await connection.run(sql, params as never[]);
      }
      await connection.run('COMMIT');
    } catch (error) {
      await connection.run('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }

  async applyChangesSql(changes: ChangeSet): Promise<string> {
    return buildChangePreview(changes, DUCKDB_DIALECT);
  }

  async beginTransaction(tabId: string): Promise<void> {
    this.assertWritable();
    if (this.openTransactions.has(tabId)) return;
    await this.require().run('BEGIN TRANSACTION');
    this.openTransactions.add(tabId);
  }

  async commitTransaction(tabId: string): Promise<void> {
    if (!this.openTransactions.delete(tabId)) return;
    await this.require().run('COMMIT');
  }

  async rollbackTransaction(tabId: string): Promise<void> {
    if (!this.openTransactions.delete(tabId)) return;
    await this.require().run('ROLLBACK');
  }

  quoteIdentifier(value: string): string {
    return quoteIdentifier(value, DUCKDB_DIALECT);
  }
}

/** Pulls the key columns out of a CREATE INDEX statement. */
function columnsFromIndexSql(sql: string): string[] {
  const inner = /\(([^)]*)\)/.exec(sql)?.[1];
  if (!inner) return [];
  return inner
    .split(',')
    .map((part) => part.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}
