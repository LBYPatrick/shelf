import { createPool, type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import { capabilities } from '../capabilities';
import { encodeRows, tagFields } from '../transcode';
import type {
  ChangeSet,
  Column,
  ConnectionConfig,
  Cursor,
  DatabaseClient,
  EngineId,
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

const MYSQL_DIALECT: Dialect = {
  quote: '`',
  placeholder: () => '?',
  limitClause: (limit, offset) => `LIMIT ${limit} OFFSET ${offset}`,
};

/**
 * MySQL has no schemas in the Postgres sense — its "schema" and its "database"
 * are the same thing — so entities are flat within the selected database.
 */
const MYSQL_CAPABILITIES = capabilities({
  schemas: false,
  partitions: true,
  cheapCount: false,
});

/**
 * MySQL, over `mysql2`.
 *
 * Dates are read as strings rather than JavaScript Dates: `mysql2` would
 * otherwise interpret them in the machine's timezone, silently shifting a
 * stored timestamp. The grid formats them, so the raw value is what the
 * database actually holds.
 */
export class MysqlClient implements DatabaseClient {
  readonly engine: EngineId;
  readonly capabilities = MYSQL_CAPABILITIES;

  private pool: Pool | null = null;
  private readonly transactions = new Map<string, PoolConnection>();

  constructor(
    private readonly config: ConnectionConfig,
    engine: EngineId = 'mysql'
  ) {
    this.engine = engine;
  }

  private require(): Pool {
    if (!this.pool) throw new Error('Not connected');
    return this.pool;
  }

  private assertWritable(): void {
    if (this.config.readOnly) throw new Error('This connection is read-only.');
  }

  private get database(): string | undefined {
    return this.config.database;
  }

  async connect(): Promise<void> {
    const { config } = this;

    this.pool = createPool({
      ...(config.socketPath
        ? { socketPath: config.socketPath }
        : { host: config.host, port: config.port ?? 3306 }),
      ...(config.username ? { user: config.username } : {}),
      ...(config.password ? { password: config.password } : {}),
      ...(config.database ? { database: config.database } : {}),
      ...(config.ssl?.enabled
        ? { ssl: { rejectUnauthorized: config.ssl.rejectUnauthorized } }
        : {}),
      connectionLimit: 4,
      connectTimeout: 15_000,
      // Preserve exactly what is stored: no timezone reinterpretation, and no
      // precision lost turning a BIGINT into a float.
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      multipleStatements: false,
    });

    const connection = await this.pool.getConnection();
    connection.release();
  }

  async disconnect(): Promise<void> {
    for (const connection of this.transactions.values()) {
      await connection.rollback().catch(() => undefined);
      connection.release();
    }
    this.transactions.clear();

    await this.pool?.end().catch(() => undefined);
    this.pool = null;
  }

  private async run<T extends RowDataPacket>(
    sql: string,
    params: readonly unknown[] = [],
    tabId?: string
  ): Promise<T[]> {
    const reserved = tabId ? this.transactions.get(tabId) : undefined;
    const target = reserved ?? this.require();
    const [rows] = await target.query<T[]>(sql, params as unknown[]);
    return rows;
  }

  async versionString(): Promise<string> {
    const rows = await this.run<RowDataPacket & { v: string }>('SELECT VERSION() AS v');
    const version = rows[0]?.v ?? 'unknown';
    return this.engine === 'tidb' ? `TiDB (${version})` : `MySQL ${version}`;
  }

  async ping(): Promise<void> {
    await this.run('SELECT 1');
  }

  async listDatabases(): Promise<readonly string[]> {
    const rows = await this.run<RowDataPacket & { name: string }>(
      `SELECT schema_name AS name FROM information_schema.schemata
        WHERE schema_name NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')
        ORDER BY schema_name`
    );
    return rows.map((row) => row.name);
  }

  async listSchemas(): Promise<readonly string[]> {
    return [];
  }

  async listEntities(): Promise<readonly Entity[]> {
    const rows = await this.run<
      RowDataPacket & { name: string; kind: string; comment: string | null }
    >(
      `SELECT table_name AS name, table_type AS kind, table_comment AS comment
         FROM information_schema.tables
        WHERE table_schema = COALESCE(?, DATABASE())
        ORDER BY table_name`,
      [this.database ?? null]
    );

    const entities: Entity[] = rows.map((row) => ({
      name: row.name,
      kind: row.kind === 'VIEW' ? ('view' as const) : ('table' as const),
      ...(row.comment ? { comment: row.comment } : {}),
    }));

    const routines = await this.run<RowDataPacket & { name: string; kind: string }>(
      `SELECT routine_name AS name, routine_type AS kind
         FROM information_schema.routines
        WHERE routine_schema = COALESCE(?, DATABASE())
        ORDER BY routine_name`,
      [this.database ?? null]
    );

    for (const row of routines) {
      entities.push({
        name: row.name,
        kind: 'routine',
        routineType: row.kind === 'PROCEDURE' ? 'procedure' : 'function',
      });
    }

    return entities;
  }

  async listColumns(entity: EntityRef): Promise<readonly Column[]> {
    const rows = await this.run<
      RowDataPacket & {
        name: string;
        data_type: string;
        nullable: string;
        default_value: string | null;
        column_key: string;
        extra: string;
        comment: string | null;
        ordinal: number;
      }
    >(
      // Every column is aliased, including the ones whose names are already
      // what we want: MySQL returns unaliased information_schema columns in
      // upper case, and reading `row.column_key` off `COLUMN_KEY` silently
      // yields undefined — which showed up as every MySQL table appearing to
      // have no primary key, and editing being disabled everywhere.
      `SELECT column_name AS name, column_type AS data_type, is_nullable AS nullable,
              column_default AS default_value, column_key AS column_key, extra AS extra,
              column_comment AS comment, ordinal_position AS ordinal
         FROM information_schema.columns
        WHERE table_schema = COALESCE(?, DATABASE()) AND table_name = ?
        ORDER BY ordinal_position`,
      [this.database ?? null, entity.name]
    );

    return rows.map((row) => ({
      name: row.name,
      dataType: row.data_type,
      nullable: row.nullable === 'YES',
      ...(row.default_value !== null ? { defaultValue: row.default_value } : {}),
      primaryKey: row.column_key === 'PRI',
      generated: /GENERATED/i.test(row.extra ?? ''),
      ...(row.comment ? { comment: row.comment } : {}),
      ordinal: row.ordinal,
    }));
  }

  async listIndexes(entity: EntityRef): Promise<readonly Index[]> {
    const rows = await this.run<
      RowDataPacket & {
        name: string;
        column_name: string;
        non_unique: number;
        index_type: string;
      }
    >(
      `SELECT index_name AS name, column_name AS column_name,
              non_unique AS non_unique, index_type AS index_type
         FROM information_schema.statistics
        WHERE table_schema = COALESCE(?, DATABASE()) AND table_name = ?
        ORDER BY index_name, seq_in_index`,
      [this.database ?? null, entity.name]
    );

    // One row per column; group them back into one index each.
    const grouped = new Map<string, Index & { columns: string[] }>();
    for (const row of rows) {
      const existing = grouped.get(row.name);
      if (existing) {
        existing.columns.push(row.column_name);
        continue;
      }
      grouped.set(row.name, {
        name: row.name,
        columns: [row.column_name],
        unique: row.non_unique === 0,
        primary: row.name === 'PRIMARY',
        type: row.index_type,
      });
    }

    return [...grouped.values()];
  }

  async listRelations(entity: EntityRef): Promise<readonly Relation[]> {
    const rows = await this.run<
      RowDataPacket & {
        name: string;
        table_name: string;
        column_name: string;
        ref_table: string;
        ref_column: string;
        update_rule: string;
        delete_rule: string;
      }
    >(
      `SELECT k.constraint_name AS name, k.table_name AS table_name,
              k.column_name AS column_name,
              k.referenced_table_name AS ref_table, k.referenced_column_name AS ref_column,
              r.update_rule AS update_rule, r.delete_rule AS delete_rule
         FROM information_schema.key_column_usage k
         JOIN information_schema.referential_constraints r
           ON r.constraint_name = k.constraint_name AND r.constraint_schema = k.table_schema
        WHERE k.table_schema = COALESCE(?, DATABASE())
          AND (k.table_name = ? OR k.referenced_table_name = ?)
          AND k.referenced_table_name IS NOT NULL
        ORDER BY k.constraint_name, k.ordinal_position`,
      [this.database ?? null, entity.name, entity.name]
    );

    const grouped = new Map<
      string,
      Relation & { columns: string[]; referencedColumns: string[] }
    >();
    for (const row of rows) {
      const outgoing = row.table_name === entity.name;
      const key = `${row.name}:${outgoing ? 'out' : 'in'}`;
      const existing = grouped.get(key);

      if (existing) {
        existing.columns.push(outgoing ? row.column_name : row.ref_column);
        existing.referencedColumns.push(outgoing ? row.ref_column : row.column_name);
        continue;
      }

      grouped.set(key, {
        name: row.name,
        direction: outgoing ? 'outgoing' : 'incoming',
        columns: [outgoing ? row.column_name : row.ref_column],
        referencedTable: { name: outgoing ? row.ref_table : row.table_name },
        referencedColumns: [outgoing ? row.ref_column : row.column_name],
        onUpdate: row.update_rule,
        onDelete: row.delete_rule,
      });
    }

    return [...grouped.values()];
  }

  async listTriggers(entity: EntityRef): Promise<readonly Trigger[]> {
    const rows = await this.run<
      RowDataPacket & { name: string; timing: string; event: string; statement: string }
    >(
      `SELECT trigger_name AS name, action_timing AS timing,
              event_manipulation AS event, action_statement AS statement
         FROM information_schema.triggers
        WHERE trigger_schema = COALESCE(?, DATABASE()) AND event_object_table = ?`,
      [this.database ?? null, entity.name]
    );
    return rows.map((row) => ({
      name: row.name,
      timing: row.timing,
      event: row.event,
      statement: row.statement,
    }));
  }

  async listPartitions(entity: EntityRef): Promise<readonly Partition[]> {
    const rows = await this.run<
      RowDataPacket & { name: string | null; expression: string | null }
    >(
      `SELECT partition_name AS name, partition_expression AS expression
         FROM information_schema.partitions
        WHERE table_schema = COALESCE(?, DATABASE()) AND table_name = ?
          AND partition_name IS NOT NULL
        ORDER BY partition_ordinal_position`,
      [this.database ?? null, entity.name]
    );
    return rows
      .filter((row): row is typeof row & { name: string } => row.name !== null)
      .map((row) => ({
        name: row.name,
        ...(row.expression ? { expression: row.expression } : {}),
      }));
  }

  async getProperties(entity: EntityRef): Promise<EntityProperties> {
    const rows = await this.run<
      RowDataPacket & {
        row_estimate: number | null;
        data_size: number | null;
        index_size: number | null;
        comment: string | null;
      }
    >(
      `SELECT table_rows AS row_estimate, data_length AS data_size,
              index_length AS index_size, table_comment AS comment
         FROM information_schema.tables
        WHERE table_schema = COALESCE(?, DATABASE()) AND table_name = ?`,
      [this.database ?? null, entity.name]
    );

    const row = rows[0];
    if (!row) return {};

    return {
      // information_schema row counts are estimates for InnoDB, and can be
      // wildly off; the grid labels them as approximate.
      ...(row.row_estimate !== null ? { rowCount: row.row_estimate } : {}),
      ...(row.data_size !== null ? { dataSizeBytes: row.data_size } : {}),
      ...(row.index_size !== null ? { indexSizeBytes: row.index_size } : {}),
      ...(row.comment ? { comment: row.comment } : {}),
    };
  }

  private buildSelect(request: SelectRequest): { sql: string; params: unknown[] } {
    const where = buildWhere(request.filters, MYSQL_DIALECT);
    return {
      sql:
        `SELECT ${buildSelectList(request.select, MYSQL_DIALECT)} ` +
        `FROM ${qualify(request.entity, MYSQL_DIALECT)}` +
        where.sql +
        buildOrderBy(request.orderBy, MYSQL_DIALECT) +
        ` ${MYSQL_DIALECT.limitClause(request.limit, request.offset)}`,
      params: [...where.params],
    };
  }

  async selectTop(request: SelectRequest): Promise<Page> {
    const { sql, params } = this.buildSelect(request);
    const [rows, fields] = await this.require().query<RowDataPacket[]>(sql, params);
    const encoded = encodeRows(rows as Record<string, unknown>[]);

    return {
      rows: encoded,
      fields: tagFields(
        (fields ?? []).map((field) => ({ name: field.name })),
        encoded
      ),
    };
  }

  async selectTopSql(request: SelectRequest): Promise<string> {
    return this.buildSelect(request).sql;
  }

  async count(entity: EntityRef, filters?: Filters): Promise<number> {
    const where = buildWhere(filters, MYSQL_DIALECT);
    const rows = await this.run<RowDataPacket & { n: number }>(
      `SELECT COUNT(*) AS n FROM ${qualify(entity, MYSQL_DIALECT)}${where.sql}`,
      where.params
    );
    return Number(rows[0]?.n ?? 0);
  }

  async query(
    text: string,
    options: QueryOptions,
    signal?: AbortSignal
  ): Promise<readonly ResultSet[]> {
    const statements = splitStatements(text);
    const results: ResultSet[] = [];

    const reserved = options.tabId ? this.transactions.get(options.tabId) : undefined;
    const connection = reserved ?? (await this.require().getConnection());

    // Cancelling means killing the query on the server from a second
    // connection; abandoning the promise here would leave it running.
    const threadId = (connection as unknown as { threadId?: number }).threadId;
    const cancel = () => {
      if (threadId === undefined) return;
      void this.require()
        .query(`KILL QUERY ${threadId}`)
        .catch(() => undefined);
    };
    signal?.addEventListener('abort', cancel);

    try {
      for (const statement of statements) {
        if (signal?.aborted) break;

        const started = performance.now();
        const [result, fields] = await connection.query<RowDataPacket[]>(statement);
        const durationMs = performance.now() - started;

        if (Array.isArray(result)) {
          const truncated = result.length > options.maxRows;
          const rows = encodeRows(
            (truncated ? result.slice(0, options.maxRows) : result) as Record<string, unknown>[]
          );

          results.push({
            fields: tagFields(
              (fields ?? []).map((field) => ({ name: field.name })),
              rows
            ),
            rows,
            truncated,
            rowCount: result.length,
            statement,
            durationMs,
          });
          continue;
        }

        const info = result as unknown as { affectedRows?: number };
        results.push({
          fields: [],
          rows: [],
          truncated: false,
          rowCount: 0,
          ...(info.affectedRows !== undefined ? { affectedRows: info.affectedRows } : {}),
          statement,
          durationMs,
        });
      }
    } finally {
      signal?.removeEventListener('abort', cancel);
      if (!reserved) connection.release();
    }

    return results;
  }

  async stream(request: StreamRequest): Promise<Cursor> {
    const connection = await this.require().getConnection();

    const sql = request.query
      ? request.query
      : this.buildSelect({
          entity: request.entity!,
          offset: 0,
          limit: Number.MAX_SAFE_INTEGER,
          ...(request.orderBy ? { orderBy: request.orderBy } : {}),
          ...(request.filters ? { filters: request.filters } : {}),
        }).sql;

    const params = request.query ? [] : buildWhere(request.filters, MYSQL_DIALECT).params;

    // mysql2's streaming interface is event-based; this adapts it to a pull
    // model so the caller controls the pace and memory stays bounded.
    //
    // The stream is driven with pause/resume rather than `for await`. Breaking
    // out of a `for await` loop calls the iterator's `return()`, which destroys
    // the underlying stream — so the first chunk would arrive and every read
    // after it would abort.
    const stream = connection.connection.query(sql, params as unknown[]).stream({
      highWaterMark: request.chunkSize,
    });

    const fields: Field[] = [];
    const buffer: Record<string, unknown>[] = [];

    let ended = false;
    let failure: Error | undefined;
    let notify: (() => void) | undefined;

    const wake = () => {
      notify?.();
      notify = undefined;
    };

    stream.on('data', (row: Record<string, unknown>) => {
      buffer.push(row);
      if (buffer.length >= request.chunkSize) stream.pause();
      wake();
    });

    stream.on('end', () => {
      ended = true;
      wake();
    });

    stream.on('error', (error: Error) => {
      failure = error;
      ended = true;
      wake();
    });

    return {
      get fields() {
        return fields;
      },
      async read() {
        // Wait until there is either a full chunk, or the stream finished.
        while (buffer.length < request.chunkSize && !ended) {
          stream.resume();
          await new Promise<void>((resolve) => (notify = resolve));
        }

        if (failure) throw failure;

        const chunk = buffer.splice(0, request.chunkSize);
        if (fields.length === 0 && chunk[0]) {
          for (const name of Object.keys(chunk[0])) fields.push({ name });
        }

        return encodeRows(chunk);
      },
      async close() {
        ended = true;
        stream.destroy();
        wake();
        connection.release();
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

    const statements = buildChangeStatements(changes, MYSQL_DIALECT);
    if (statements.length === 0) return;

    const connection = await this.require().getConnection();
    try {
      await connection.beginTransaction();
      for (const { sql, params } of statements) {
        await connection.query(sql, params as unknown[]);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  async applyChangesSql(changes: ChangeSet): Promise<string> {
    return buildChangePreview(changes, MYSQL_DIALECT);
  }

  async beginTransaction(tabId: string): Promise<void> {
    this.assertWritable();
    if (this.transactions.has(tabId)) return;

    const connection = await this.require().getConnection();
    await connection.beginTransaction();
    this.transactions.set(tabId, connection);
  }

  async commitTransaction(tabId: string): Promise<void> {
    const connection = this.transactions.get(tabId);
    if (!connection) return;
    this.transactions.delete(tabId);
    try {
      await connection.commit();
    } finally {
      connection.release();
    }
  }

  async rollbackTransaction(tabId: string): Promise<void> {
    const connection = this.transactions.get(tabId);
    if (!connection) return;
    this.transactions.delete(tabId);
    try {
      await connection.rollback();
    } finally {
      connection.release();
    }
  }

  quoteIdentifier(value: string): string {
    return quoteIdentifier(value, MYSQL_DIALECT);
  }
}
