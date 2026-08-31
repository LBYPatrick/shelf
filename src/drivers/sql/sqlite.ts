import { limitStatement } from '@shared/rowLimit';
import Database from 'better-sqlite3';
import { capabilities } from '../capabilities';
import { encodeRows, tagFields } from '../transcode';
import type {
  ChangeSet,
  Column,
  ConnectionConfig,
  ContainerProperties,
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
import {
  ANSI_DIALECT,
  buildOrderBy,
  buildSelectList,
  buildWhere,
  qualify,
  quoteIdentifier,
  type Dialect,
} from './dialect';
import { singleSourceTable, splitStatements } from './statements';

const SQLITE_DIALECT: Dialect = ANSI_DIALECT;

/** SQLite has no schemas, one database per file, and no server to tunnel to. */
const SQLITE_CAPABILITIES = capabilities({
  schemas: false,
  multipleDatabases: false,
  routines: false,
  partitions: false,
  comments: false,
  // A COUNT(*) on a SQLite table is a scan, but a local one over a file — fast
  // enough to offer on every page, unlike a network round trip to a huge table.
  cheapCount: true,
  sshTunnel: false,
  builtInEntities: true,
});

interface SqliteTableInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
  hidden?: number;
}

/**
 * SQLite, over better-sqlite3.
 *
 * The driver is synchronous underneath, which is exactly why it belongs in the
 * connection host: a long scan blocks this process's event loop and nothing
 * else. In the interface process it would freeze the window.
 */
export class SqliteClient implements DatabaseClient {
  readonly engine = 'sqlite' as const;
  readonly capabilities = SQLITE_CAPABILITIES;

  private db: Database.Database | null = null;
  /** Tabs that have opened a manual transaction. */
  private readonly openTransactions = new Set<string>();

  constructor(private readonly config: ConnectionConfig) {}

  private require(): Database.Database {
    if (!this.db) throw new Error('Not connected');
    return this.db;
  }

  private assertWritable(): void {
    if (this.config.readOnly) {
      throw new Error('This connection is read-only.');
    }
  }

  async connect(): Promise<void> {
    // An absent path means an in-memory database, which is genuinely useful for
    // scratch work and is what DuckDB and SQLite both default to.
    const file = this.config.filePath ?? ':memory:';

    this.db = new Database(file, { readonly: this.config.readOnly ?? false });
    this.db.pragma('foreign_keys = ON');

    // WAL is a persistent property of the file and cannot be set on a read-only
    // handle or an in-memory database.
    if (!this.config.readOnly && file !== ':memory:') {
      this.db.pragma('journal_mode = WAL');
    }
  }

  async disconnect(): Promise<void> {
    this.db?.close();
    this.db = null;
    this.openTransactions.clear();
  }

  async versionString(): Promise<string> {
    const row = this.require().prepare('SELECT sqlite_version() AS v').get() as { v: string };
    return `SQLite ${row.v}`;
  }

  async ping(): Promise<void> {
    this.require().prepare('SELECT 1').get();
  }

  async listDatabases(): Promise<readonly string[]> {
    return [this.config.filePath ?? ':memory:'];
  }

  async listSchemas(): Promise<readonly string[]> {
    return [];
  }

  async listEntities(
    _schema?: string,
    options?: ListEntitiesOptions
  ): Promise<readonly Entity[]> {
    /*
     * `sqlite_sequence` and the `sqlite_stat*` tables. Few enough that fetching
     * them costs nothing, and useful often enough to be worth a switch: the
     * sequence table is where an AUTOINCREMENT's next value actually lives.
     */
    const rows = this.require()
      .prepare(
        `SELECT name, type FROM sqlite_master
         WHERE type IN ('table', 'view') AND (? OR name NOT LIKE 'sqlite_%')
         ORDER BY name`
      )
      .all(options?.builtIns === true ? 1 : 0) as { name: string; type: string }[];

    return rows.map((row) => ({
      name: row.name,
      kind: row.type === 'view' ? ('view' as const) : ('table' as const),
      ...(row.name.startsWith('sqlite_') ? { builtIn: true } : {}),
    }));
  }

  async listColumns(entity: EntityRef): Promise<readonly Column[]> {
    // table_xinfo rather than table_info so generated columns are included; they
    // are shown but not editable, which is only knowable if we can see them.
    const rows = this.require()
      .prepare(`PRAGMA table_xinfo(${quoteIdentifier(entity.name, SQLITE_DIALECT)})`)
      .all() as SqliteTableInfo[];

    return rows.map((row) => ({
      name: row.name,
      dataType: row.type || 'BLOB',
      nullable: row.notnull === 0,
      ...(row.dflt_value !== null ? { defaultValue: row.dflt_value } : {}),
      primaryKey: row.pk > 0,
      // hidden 2 and 3 are VIRTUAL and STORED generated columns.
      generated: row.hidden === 2 || row.hidden === 3,
      ordinal: row.cid,
    }));
  }

  async listIndexes(entity: EntityRef): Promise<readonly Index[]> {
    const db = this.require();
    const table = quoteIdentifier(entity.name, SQLITE_DIALECT);

    const indexes = db.prepare(`PRAGMA index_list(${table})`).all() as {
      name: string;
      unique: number;
      origin: string;
    }[];

    return indexes.map((index) => {
      const columns = (
        db
          .prepare(`PRAGMA index_info(${quoteIdentifier(index.name, SQLITE_DIALECT)})`)
          .all() as {
          name: string | null;
        }[]
      )
        .map((column) => column.name)
        .filter((name): name is string => name !== null);

      return {
        name: index.name,
        columns,
        unique: index.unique === 1,
        primary: index.origin === 'pk',
      };
    });
  }

  async listRelations(entity: EntityRef): Promise<readonly Relation[]> {
    const db = this.require();

    const outgoing = (
      db
        .prepare(`PRAGMA foreign_key_list(${quoteIdentifier(entity.name, SQLITE_DIALECT)})`)
        .all() as {
        id: number;
        table: string;
        from: string;
        to: string | null;
        on_update: string;
        on_delete: string;
      }[]
    ).reduce<Map<number, Relation>>((map, row) => {
      // A composite key arrives as several rows sharing an id.
      const existing = map.get(row.id);
      if (existing) {
        map.set(row.id, {
          ...existing,
          columns: [...existing.columns, row.from],
          referencedColumns: [...existing.referencedColumns, row.to ?? ''],
        });
        return map;
      }

      map.set(row.id, {
        name: `fk_${entity.name}_${row.id}`,
        direction: 'outgoing',
        columns: [row.from],
        referencedTable: { name: row.table },
        referencedColumns: [row.to ?? ''],
        onUpdate: row.on_update,
        onDelete: row.on_delete,
      });
      return map;
    }, new Map());

    // SQLite cannot be asked what points *at* a table, so every other table's
    // foreign keys are inspected. Acceptable because the schema is local.
    const incoming: Relation[] = [];
    const tables = (
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
        )
        .all() as { name: string }[]
    ).map((row) => row.name);

    for (const table of tables) {
      if (table === entity.name) continue;
      const keys = db
        .prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table, SQLITE_DIALECT)})`)
        .all() as { table: string; from: string; to: string | null }[];

      for (const key of keys) {
        if (key.table !== entity.name) continue;
        incoming.push({
          name: `fk_${table}_${key.from}`,
          direction: 'incoming',
          columns: [key.to ?? ''],
          referencedTable: { name: table },
          referencedColumns: [key.from],
        });
      }
    }

    return [...outgoing.values(), ...incoming];
  }

  async listTriggers(entity: EntityRef): Promise<readonly Trigger[]> {
    const rows = this.require()
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?`)
      .all(entity.name) as { name: string; sql: string | null }[];

    return rows.map((row) => {
      const sql = row.sql ?? '';
      return {
        name: row.name,
        timing: /\bBEFORE\b/i.test(sql)
          ? 'BEFORE'
          : /\bINSTEAD OF\b/i.test(sql)
            ? 'INSTEAD OF'
            : 'AFTER',
        event: /\bINSERT\b/i.test(sql)
          ? 'INSERT'
          : /\bUPDATE\b/i.test(sql)
            ? 'UPDATE'
            : 'DELETE',
        ...(row.sql ? { statement: row.sql } : {}),
      };
    });
  }

  async listPartitions(): Promise<readonly Partition[]> {
    return [];
  }

  async getProperties(entity: EntityRef): Promise<EntityProperties> {
    return { rowCount: await this.count(entity) };
  }

  /**
   * A SQLite database is a file, so what it has to say about itself is what the
   * file is: how big, what page size, which journal mode. The pragmas are read
   * rather than the file stat'ed, because a database in WAL mode has its recent
   * pages in a sibling file the size on disk would not account for.
   */
  async getContainerProperties(): Promise<ContainerProperties> {
    const db = this.require();
    const pragma = <T>(name: string): T => db.pragma(name, { simple: true }) as T;

    const pageSize = pragma<number>('page_size');
    const pageCount = pragma<number>('page_count');

    const counts = db
      .prepare(
        `SELECT type, count(*) AS n FROM sqlite_master
          WHERE name NOT LIKE 'sqlite_%' GROUP BY type`
      )
      .all() as { type: string; n: number }[];
    const countOf = (type: string) => counts.find((row) => row.type === type)?.n ?? 0;

    return {
      facts: [
        { key: 'size', bytes: pageSize * pageCount },
        { key: 'file', text: this.config.filePath ?? ':memory:' },
        { key: 'pageSize', bytes: pageSize },
        { key: 'journalMode', text: String(pragma<string>('journal_mode')) },
        { key: 'encoding', text: String(pragma<string>('encoding')) },
        { key: 'tables', count: countOf('table') },
        { key: 'indexes', count: countOf('index') },
        { key: 'views', count: countOf('view') },
      ],
    };
  }

  async selectTop(request: SelectRequest): Promise<Page> {
    const { sql, params } = this.buildSelect(request);
    const statement = this.require().prepare(sql);

    const rawRows = statement.all(...params) as Record<string, unknown>[];
    const rows = encodeRows(rawRows);

    const columns = statement.columns().map((column) => ({
      name: column.name,
      ...(column.type ? { dataType: column.type } : {}),
    }));

    return {
      rows,
      fields: tagFields(columns, rows),
      totalRowCount: await this.count(request.entity, request.filters),
    };
  }

  async selectTopSql(request: SelectRequest): Promise<string> {
    return this.buildSelect(request).sql;
  }

  private buildSelect(request: SelectRequest): { sql: string; params: unknown[] } {
    const where = buildWhere(request.filters, SQLITE_DIALECT);
    const sql =
      `SELECT ${buildSelectList(request.select, SQLITE_DIALECT)} ` +
      `FROM ${qualify(request.entity, SQLITE_DIALECT)}` +
      where.sql +
      buildOrderBy(request.orderBy, SQLITE_DIALECT) +
      ` ${SQLITE_DIALECT.limitClause(request.limit, request.offset)}`;

    return { sql, params: [...where.params] };
  }

  async count(entity: EntityRef, filters?: Filters): Promise<number> {
    const where = buildWhere(filters, SQLITE_DIALECT);
    const row = this.require()
      .prepare(`SELECT COUNT(*) AS n FROM ${qualify(entity, SQLITE_DIALECT)}${where.sql}`)
      .get(...where.params) as { n: number };
    return row.n;
  }

  async query(text: string, options: QueryOptions): Promise<readonly ResultSet[]> {
    const db = this.require();
    const statements = splitStatements(text);
    const results: ResultSet[] = [];

    for (const statement of statements) {
      const started = performance.now();
      const prepared = db.prepare(limitStatement(statement, options.maxRows));

      if (prepared.reader) {
        // `raw` is avoided so duplicate column names do not silently collapse;
        // better-sqlite3 already disambiguates them in object mode.
        const all = prepared.all() as Record<string, unknown>[];
        const truncated = all.length > options.maxRows;
        const rows = encodeRows(truncated ? all.slice(0, options.maxRows) : all);

        const fields = tagFields(
          prepared.columns().map((column) => ({
            name: column.name,
            ...(column.type ? { dataType: column.type } : {}),
          })),
          rows
        );

        results.push({
          fields,
          rows,
          truncated,
          rowCount: rows.length,
          statement,
          durationMs: performance.now() - started,
        });
        continue;
      }

      this.assertWritable();
      const info = prepared.run();
      results.push({
        fields: [],
        rows: [],
        truncated: false,
        rowCount: 0,
        affectedRows: info.changes,
        statement,
        durationMs: performance.now() - started,
      });
    }

    return results;
  }

  async stream(request: StreamRequest): Promise<Cursor> {
    const db = this.require();

    const sql = request.query
      ? request.query
      : this.buildSelect({
          entity: request.entity!,
          offset: 0,
          limit: Number.MAX_SAFE_INTEGER,
          ...(request.orderBy ? { orderBy: request.orderBy } : {}),
          ...(request.filters ? { filters: request.filters } : {}),
        }).sql;

    const statement = db.prepare(sql);
    const params = request.query ? [] : buildWhere(request.filters, SQLITE_DIALECT).params;
    const iterator = statement.iterate(...params) as IterableIterator<Record<string, unknown>>;

    const fields: Field[] = statement.columns().map((column) => ({
      name: column.name,
      ...(column.type ? { dataType: column.type } : {}),
    }));

    let done = false;

    return {
      fields,
      async read() {
        if (done) return [];
        const chunk: Record<string, unknown>[] = [];
        for (const row of iterator) {
          chunk.push(row);
          if (chunk.length >= request.chunkSize) return encodeRows(chunk);
        }
        done = true;
        return encodeRows(chunk);
      },
      async close() {
        done = true;
        iterator.return?.();
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
      if (!column)
        return { field: field.name, editable: false, reason: 'ambiguous-mapping' as const };
      if (column.generated)
        return { field: field.name, editable: false, reason: 'computed-column' as const };
      if (!hasPrimaryKey) {
        // Without a key there is no safe way to address one row, and an UPDATE
        // matching on values could change several.
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
    const db = this.require();

    // One transaction for the whole set: a partially applied grid edit would
    // leave the user's data in a state they never asked for.
    const apply = db.transaction(() => {
      for (const insert of changes.inserts) {
        const columns = Object.keys(insert.values);
        if (columns.length === 0) continue;
        db.prepare(
          `INSERT INTO ${qualify(insert.entity, SQLITE_DIALECT)} ` +
            `(${columns.map((c) => quoteIdentifier(c, SQLITE_DIALECT)).join(', ')}) ` +
            `VALUES (${columns.map(() => '?').join(', ')})`
        ).run(...columns.map((column) => toBindable(insert.values[column])));
      }

      for (const update of changes.updates) {
        const keys = update.primaryKeys;
        if (keys.length === 0) throw new Error('Cannot update a row without a primary key.');
        db.prepare(
          `UPDATE ${qualify(update.entity, SQLITE_DIALECT)} ` +
            `SET ${quoteIdentifier(update.column, SQLITE_DIALECT)} = ? ` +
            `WHERE ${keys.map((k) => `${quoteIdentifier(k.column, SQLITE_DIALECT)} = ?`).join(' AND ')}`
        ).run(toBindable(update.value), ...keys.map((k) => toBindable(k.value)));
      }

      for (const remove of changes.deletes) {
        const keys = remove.primaryKeys;
        if (keys.length === 0) throw new Error('Cannot delete a row without a primary key.');
        db.prepare(
          `DELETE FROM ${qualify(remove.entity, SQLITE_DIALECT)} ` +
            `WHERE ${keys.map((k) => `${quoteIdentifier(k.column, SQLITE_DIALECT)} = ?`).join(' AND ')}`
        ).run(...keys.map((k) => toBindable(k.value)));
      }
    });

    apply();
  }

  async applyChangesSql(changes: ChangeSet): Promise<string> {
    const lines: string[] = [];

    for (const insert of changes.inserts) {
      const columns = Object.keys(insert.values);
      lines.push(
        `INSERT INTO ${qualify(insert.entity, SQLITE_DIALECT)} ` +
          `(${columns.map((c) => quoteIdentifier(c, SQLITE_DIALECT)).join(', ')}) ` +
          `VALUES (${columns.map((c) => literal(insert.values[c])).join(', ')});`
      );
    }

    for (const update of changes.updates) {
      lines.push(
        `UPDATE ${qualify(update.entity, SQLITE_DIALECT)} ` +
          `SET ${quoteIdentifier(update.column, SQLITE_DIALECT)} = ${literal(update.value)} ` +
          `WHERE ${update.primaryKeys
            .map((k) => `${quoteIdentifier(k.column, SQLITE_DIALECT)} = ${literal(k.value)}`)
            .join(' AND ')};`
      );
    }

    for (const remove of changes.deletes) {
      lines.push(
        `DELETE FROM ${qualify(remove.entity, SQLITE_DIALECT)} ` +
          `WHERE ${remove.primaryKeys
            .map((k) => `${quoteIdentifier(k.column, SQLITE_DIALECT)} = ${literal(k.value)}`)
            .join(' AND ')};`
      );
    }

    return lines.join('\n');
  }

  async beginTransaction(tabId: string): Promise<void> {
    this.assertWritable();
    if (this.openTransactions.has(tabId)) return;
    this.require().prepare('BEGIN').run();
    this.openTransactions.add(tabId);
  }

  async commitTransaction(tabId: string): Promise<void> {
    if (!this.openTransactions.delete(tabId)) return;
    this.require().prepare('COMMIT').run();
  }

  async rollbackTransaction(tabId: string): Promise<void> {
    if (!this.openTransactions.delete(tabId)) return;
    this.require().prepare('ROLLBACK').run();
  }

  quoteIdentifier(value: string): string {
    return quoteIdentifier(value, SQLITE_DIALECT);
  }
}

/** better-sqlite3 binds only these; everything else must be converted first. */
function toBindable(value: unknown): string | number | bigint | Buffer | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return value;
  }
  if (value instanceof Uint8Array) return Buffer.from(value);

  const tagged = value as { $?: string; data?: string };
  if (tagged.$ === 'binary' && tagged.data) return Buffer.from(tagged.data, 'base64');
  if (tagged.$ === 'bigint' && tagged.data) return BigInt(tagged.data);
  if (tagged.$ && tagged.data !== undefined) return tagged.data;

  return JSON.stringify(value);
}

/** Renders a value as SQL text, for previews only — never for execution. */
function literal(value: unknown): string {
  const bindable = toBindable(value);
  if (bindable === null) return 'NULL';
  if (typeof bindable === 'number' || typeof bindable === 'bigint') return String(bindable);
  if (Buffer.isBuffer(bindable)) return `X'${bindable.toString('hex')}'`;
  return `'${bindable.split("'").join("''")}'`;
}
