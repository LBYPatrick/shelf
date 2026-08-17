/**
 * The one abstraction every engine implements.
 *
 * Nine engines sit behind this interface, and four of them are not relational
 * at all. The design principle throughout is that differences are *declared*
 * rather than thrown: a driver advertises what it can do through `capabilities`
 * and the interface omits nothing, so the UI decides what to render by reading
 * capabilities instead of calling a method and catching "not supported".
 */

export type EngineId =
  | 'postgres'
  | 'mysql'
  | 'tidb'
  | 'sqlite'
  | 'duckdb'
  | 'redis'
  | 'mongodb'
  | 'scylla'
  | 'dynamodb'
  /** Not a database: synthetic sample data, for exploring the app with nothing installed. */
  | 'mock';

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/** How completely an engine can filter and sort on the server. */
export type PushdownSupport = 'full' | 'partial' | 'none';

export interface Capabilities {
  /** The engine takes SQL. False for Redis and MongoDB, whose consoles differ. */
  readonly sql: boolean;
  /** The language shown in the editor, for syntax highlighting and formatting. */
  readonly queryLanguage: 'sql' | 'cql' | 'partiql' | 'javascript' | 'redis';
  /** Entities live under named schemas (Postgres) rather than flat (SQLite, Redis). */
  readonly schemas: boolean;
  /** The server hosts multiple databases we can switch between. */
  readonly multipleDatabases: boolean;
  readonly transactions: boolean;
  readonly indexes: boolean;
  readonly relations: boolean;
  readonly triggers: boolean;
  readonly partitions: boolean;
  readonly views: boolean;
  readonly routines: boolean;
  readonly comments: boolean;
  /** DDL is expressible, so the structure editor can offer to change things. */
  readonly ddl: boolean;
  readonly sortPushdown: PushdownSupport;
  readonly filterPushdown: PushdownSupport;
  /**
   * A total row count is cheap enough to ask for on every page. False for
   * engines where counting means a full scan, which is what decides whether the
   * pager offers a "last page" button.
   */
  readonly cheapCount: boolean;
  /** Rows can be streamed in chunks, so exports do not have to fit in memory. */
  readonly streaming: boolean;
  /** Connections can be tunnelled over SSH. */
  readonly sshTunnel: boolean;
  /** The engine has its own console, shown instead of or beside the SQL editor. */
  readonly nativeShell: boolean;
  /**
   * A database or a schema can describe itself, not just a table. False for
   * stores where the container is a namespace and nothing more.
   */
  readonly containers: boolean;
  /**
   * The server keeps per-statement timings and server-wide counters we can
   * read. Declared rather than discovered because the answer is a property of
   * the engine; whether the *extension* that provides them is installed on this
   * particular server is a separate question the driver answers at run time.
   */
  readonly statistics: boolean;
  /** What this engine calls its top-level container, for UI labels. */
  readonly nouns: EngineNouns;
}

/**
 * Engines disagree about what things are called, and using the wrong word makes
 * an interface feel like it was written for a different product.
 */
export interface EngineNouns {
  /** "database" | "keyspace" | "region" */
  readonly database: string;
  /** "table" | "collection" | "key" */
  readonly entity: string;
  /** "row" | "document" | "item" */
  readonly row: string;
  /** "column" | "field" | "attribute" */
  readonly column: string;
}

// ---------------------------------------------------------------------------
// Connection configuration
// ---------------------------------------------------------------------------

export type SshAuthMode = 'agent' | 'password' | 'keyfile';

export interface SshConfig {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly mode: SshAuthMode;
  readonly password?: string;
  readonly keyfile?: string;
  readonly passphrase?: string;
  readonly keepaliveInterval?: number;
}

export interface SslConfig {
  readonly enabled: boolean;
  readonly rejectUnauthorized: boolean;
  readonly caFile?: string;
  readonly certFile?: string;
  readonly keyFile?: string;
}

export interface ConnectionConfig {
  readonly engine: EngineId;
  readonly host?: string;
  readonly port?: number;
  readonly username?: string;
  readonly password?: string;
  /** SQLite and DuckDB connect to a file rather than a host. */
  readonly filePath?: string;
  /** Unix socket, where the engine supports it. */
  readonly socketPath?: string;
  readonly database?: string;
  /** Full connection URI, when the user supplied one instead of fields. */
  readonly url?: string;
  readonly ssl?: SslConfig;
  readonly ssh?: SshConfig;
  /** Engine-specific settings that do not generalise (AWS region, Cassandra DC). */
  readonly options?: Readonly<Record<string, unknown>>;
  /** Refuse anything that writes. Enforced in the driver, not just the UI. */
  readonly readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Schema model
// ---------------------------------------------------------------------------

export type EntityKind = 'table' | 'view' | 'materialized-view' | 'routine' | 'collection';

export interface EntityRef {
  readonly name: string;
  readonly schema?: string;
}

export interface Entity extends EntityRef {
  readonly kind: EntityKind;
  /** Routine subtype, where it matters. */
  readonly routineType?: 'function' | 'procedure';
  readonly comment?: string;
}

export interface Column {
  readonly name: string;
  /** The engine's own type name, shown verbatim so it is recognisable. */
  readonly dataType: string;
  readonly nullable: boolean;
  readonly defaultValue?: string;
  readonly primaryKey: boolean;
  readonly generated?: boolean;
  readonly comment?: string;
  readonly ordinal: number;
}

export interface Index {
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
  readonly primary: boolean;
  readonly type?: string;
}

export interface Relation {
  readonly name: string;
  readonly direction: 'outgoing' | 'incoming';
  readonly columns: readonly string[];
  readonly referencedTable: EntityRef;
  readonly referencedColumns: readonly string[];
  readonly onUpdate?: string;
  readonly onDelete?: string;
}

export interface Trigger {
  readonly name: string;
  readonly timing: string;
  readonly event: string;
  readonly statement?: string;
}

export interface Partition {
  readonly name: string;
  readonly expression?: string;
}

export interface EntityProperties {
  readonly rowCount?: number;
  readonly dataSizeBytes?: number;
  readonly indexSizeBytes?: number;
  readonly comment?: string;
}

/** A database or a schema — the two things a table lives inside. */
export interface ContainerRef {
  readonly kind: 'database' | 'schema';
  readonly name: string;
}

/**
 * One thing an engine wants to say about a container.
 *
 * Free-form rather than a fixed record because the interesting facts differ by
 * engine and pretending otherwise produces a form with half its fields empty:
 * Postgres has an owner, a collation and a tablespace, SQLite has a page size
 * and a journal mode, and neither has the other's.
 *
 * `key` names the fact for translation and falls back to itself, so a driver
 * can state something the interface has never heard of without it disappearing.
 * Exactly one of the three value fields is set, which is what lets the
 * interface format a size as a size and a count as a count.
 */
export interface ContainerFact {
  readonly key: string;
  readonly text?: string;
  readonly bytes?: number;
  readonly count?: number;
}

export interface ContainerProperties {
  readonly comment?: string;
  readonly facts: readonly ContainerFact[];
  /** The biggest tables inside it, largest first. */
  readonly largest?: readonly { readonly entity: EntityRef; readonly bytes: number }[];
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/**
 * One statement, as the server's own statistics describe it.
 *
 * Every counter is cumulative since the server last reset them, which is the
 * only form the engines offer. Turning that into "the last hour" is the
 * interface's job and is done by differencing two readings — see
 * `shared/queryStats.ts`.
 */
export interface StatementStat {
  /**
   * The server's own identity for the statement, stable across readings. Two
   * readings of the same statement have to be recognisable as the same one or
   * there is nothing to difference.
   */
  readonly id: string;
  /** The normalised text, with literals replaced by placeholders. */
  readonly text: string;
  readonly calls: number;
  readonly totalMs: number;
  readonly meanMs: number;
  readonly minMs?: number;
  readonly maxMs?: number;
  readonly rows?: number;
  /** Shared-buffer hits over hits plus reads, 0 to 1, where it is tracked. */
  readonly cacheHitRatio?: number;
}

/** Every counter as it stood at one moment. */
export interface StatementSample {
  /** When the counters were read, by our clock. */
  readonly takenAt: number;
  /**
   * When the server last reset them. A reset makes every earlier reading
   * useless for differencing, and without this the difference would come out
   * negative and be silently treated as a very fast hour.
   */
  readonly resetAt?: number;
  readonly statements: readonly StatementStat[];
}

/** Why the server cannot report statement statistics at the moment. */
export type StatisticsProblem = 'unsupported' | 'not-installed' | 'not-permitted';

export type StatementReport =
  | { readonly ok: true; readonly sample: StatementSample }
  | {
      readonly ok: false;
      readonly problem: StatisticsProblem;
      /** The server's own words, when it had any. */
      readonly detail?: string;
    };

/** A single named measurement of the server as a whole. */
export interface Metric {
  readonly key: string;
  readonly value: number;
  readonly unit: 'count' | 'bytes' | 'ms' | 'seconds' | 'ratio' | 'perSecond';
  /** Above this the number is a problem rather than a fact. */
  readonly warnAbove?: number;
  /** Below this the number is a problem rather than a fact. */
  readonly warnBelow?: number;
}

export interface ServerMetrics {
  /** Headline numbers, in the order the engine wants them read. */
  readonly gauges: readonly Metric[];
  /** What the tables cost, largest first. */
  readonly largestTables: readonly {
    readonly entity: EntityRef;
    readonly totalBytes: number;
    readonly rowEstimate?: number;
    /** Dead tuples over live ones, which is bloat before it is anything else. */
    readonly deadRatio?: number;
  }[];
  /** Connections, grouped by what they are doing. */
  readonly activity: readonly { readonly state: string; readonly count: number }[];
  /** Indexes the planner has never chosen: cost without benefit. */
  readonly unusedIndexes: readonly {
    readonly entity: EntityRef;
    readonly name: string;
    readonly sizeBytes: number;
  }[];
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type FilterOperator =
  | '='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'like'
  | 'not like'
  | 'in'
  | 'not in'
  | 'is null'
  | 'is not null';

export interface ColumnFilter {
  readonly column: string;
  readonly operator: FilterOperator;
  readonly value?: unknown;
  /** How this filter joins to the previous one. */
  readonly join?: 'and' | 'or';
}

/** Either the structured builder, or whatever the user typed. */
export type Filters =
  | { readonly kind: 'builder'; readonly filters: readonly ColumnFilter[] }
  | {
      readonly kind: 'raw';
      readonly expression: string;
    };

export interface OrderBy {
  readonly column: string;
  readonly direction: 'asc' | 'desc';
}

export interface SelectRequest {
  readonly entity: EntityRef;
  readonly offset: number;
  readonly limit: number;
  readonly orderBy?: readonly OrderBy[];
  readonly filters?: Filters;
  /** Restrict to these columns; omitted means all. */
  readonly select?: readonly string[];
}

/**
 * A value tagged with how it should be interpreted after crossing the process
 * boundary. Buffers, BigInts and ObjectIds do not survive a structured clone
 * with their identity intact, so they travel tagged and are restored on arrival.
 */
export type TaggedValue =
  | { readonly $: 'binary'; readonly data: string }
  | { readonly $: 'bigint'; readonly data: string }
  | { readonly $: 'date'; readonly data: string }
  | { readonly $: 'objectid'; readonly data: string }
  | { readonly $: 'json'; readonly data: string };

export type CellValue = string | number | boolean | null | TaggedValue;

export type Row = Record<string, CellValue>;

export interface Field {
  readonly name: string;
  readonly dataType?: string;
  /** Set when the value needs decoding on arrival. */
  readonly tag?: TaggedValue['$'];
}

export interface Page {
  readonly rows: readonly Row[];
  readonly fields: readonly Field[];
  /** Total matching rows, when the engine can say cheaply. */
  readonly totalRowCount?: number;
}

export interface ResultSet {
  readonly fields: readonly Field[];
  readonly rows: readonly Row[];
  /** True when the result was cut short at the configured ceiling. */
  readonly truncated: boolean;
  readonly rowCount: number;
  readonly affectedRows?: number;
  /** The statement this result came from, for multi-statement scripts. */
  readonly statement: string;
  readonly durationMs: number;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface PrimaryKeyValue {
  readonly column: string;
  readonly value: CellValue;
}

export interface RowInsert {
  readonly entity: EntityRef;
  readonly values: Row;
}

export interface CellUpdate {
  readonly entity: EntityRef;
  readonly primaryKeys: readonly PrimaryKeyValue[];
  readonly column: string;
  readonly value: CellValue;
}

export interface RowDelete {
  readonly entity: EntityRef;
  readonly primaryKeys: readonly PrimaryKeyValue[];
}

export interface ChangeSet {
  readonly inserts: readonly RowInsert[];
  readonly updates: readonly CellUpdate[];
  readonly deletes: readonly RowDelete[];
}

/**
 * Why a result column cannot be edited. The grid shows this as the tooltip, so
 * "why is this cell locked" always has an answer.
 */
export type NotEditableReason =
  | 'no-linked-table'
  | 'missing-primary-key'
  | 'computed-column'
  | 'ambiguous-mapping'
  | 'read-only-connection'
  | 'unsupported';

export interface FieldEditability {
  readonly field: string;
  readonly editable: boolean;
  readonly reason?: NotEditableReason;
  /** Where the value actually lives, when it is editable. */
  readonly source?: { readonly entity: EntityRef; readonly column: string };
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/**
 * A chunked reader. Cursors never cross the process boundary — exports run
 * inside the host, so a very large export streams to disk without ever
 * materialising in the interface process.
 */
export interface Cursor {
  readonly fields: readonly Field[];
  /** Resolves to an empty array once exhausted. */
  read(): Promise<readonly Row[]>;
  close(): Promise<void>;
}

export interface StreamRequest {
  readonly entity?: EntityRef;
  readonly query?: string;
  readonly filters?: Filters;
  readonly orderBy?: readonly OrderBy[];
  readonly chunkSize: number;
}

// ---------------------------------------------------------------------------
// The interface
// ---------------------------------------------------------------------------

export interface QueryOptions {
  /** Cut the result off at this many rows and report `truncated`. */
  readonly maxRows: number;
  /** Ties the query to a manual transaction opened by the same tab. */
  readonly tabId?: string;
}

export interface DatabaseClient {
  readonly engine: EngineId;
  readonly capabilities: Capabilities;

  connect(signal?: AbortSignal): Promise<void>;
  disconnect(): Promise<void>;
  versionString(): Promise<string>;
  /** A cheap round-trip used to confirm the connection is still alive. */
  ping(): Promise<void>;

  listDatabases(): Promise<readonly string[]>;
  listSchemas(): Promise<readonly string[]>;
  listEntities(schema?: string): Promise<readonly Entity[]>;
  listColumns(entity: EntityRef): Promise<readonly Column[]>;
  listIndexes(entity: EntityRef): Promise<readonly Index[]>;
  listRelations(entity: EntityRef): Promise<readonly Relation[]>;
  listTriggers(entity: EntityRef): Promise<readonly Trigger[]>;
  listPartitions(entity: EntityRef): Promise<readonly Partition[]>;
  getProperties(entity: EntityRef): Promise<EntityProperties>;
  /** Present exactly when `capabilities.containers` is true. */
  getContainerProperties?(target: ContainerRef): Promise<ContainerProperties>;

  /** Both present exactly when `capabilities.statistics` is true. */
  readStatements?(): Promise<StatementReport>;
  readMetrics?(): Promise<ServerMetrics>;

  selectTop(request: SelectRequest): Promise<Page>;
  /** The same read, as text, so the user can see and copy what we would run. */
  selectTopSql(request: SelectRequest): Promise<string>;
  count(entity: EntityRef, filters?: Filters): Promise<number>;

  query(
    text: string,
    options: QueryOptions,
    signal?: AbortSignal
  ): Promise<readonly ResultSet[]>;
  stream(request: StreamRequest): Promise<Cursor>;

  resolveEditability(
    text: string,
    fields: readonly Field[]
  ): Promise<readonly FieldEditability[]>;
  applyChanges(changes: ChangeSet): Promise<void>;
  /** The same write, as text, previewed before anything is committed. */
  applyChangesSql(changes: ChangeSet): Promise<string>;

  beginTransaction(tabId: string): Promise<void>;
  commitTransaction(tabId: string): Promise<void>;
  rollbackTransaction(tabId: string): Promise<void>;

  /** Quote an identifier for this engine's dialect. */
  quoteIdentifier(value: string): string;
}
