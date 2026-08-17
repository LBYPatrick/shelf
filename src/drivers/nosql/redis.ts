import { createClient, type RedisClientType } from '@redis/client';
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

/**
 * Redis is a keyspace, not a set of tables, and pretending otherwise produces an
 * interface that lies. So it declares itself honestly: no SQL, no schemas, no
 * transactions in the interactive sense, no relations — and a native console,
 * which is how people actually drive Redis.
 *
 * The one concession to the shared shape is that the keyspace is browsable as a
 * table of keys, because scanning keys with their type, size and TTL is exactly
 * what a person opening a Redis client wants to see first.
 */
const REDIS_CAPABILITIES = capabilities({
  sql: false,
  queryLanguage: 'redis',
  schemas: false,
  multipleDatabases: true,
  transactions: false,
  indexes: false,
  relations: false,
  triggers: false,
  views: false,
  routines: false,
  comments: false,
  ddl: false,
  sortPushdown: 'none',
  filterPushdown: 'partial',
  cheapCount: false,
  streaming: true,
  nativeShell: true,
  // A Redis database is a numbered slot, not a thing with an owner and a size.
  containers: false,
  nouns: { database: 'database', entity: 'keyspace', row: 'key', column: 'field' },
});

/** The synthetic entities Redis presents. */
const KEYSPACE = 'keys';
const SERVER_INFO = 'info';

/** Columns of the keyspace view, in the order they are shown. */
const KEY_FIELDS: readonly Field[] = [
  { name: 'key', dataType: 'string' },
  { name: 'type', dataType: 'string' },
  { name: 'ttl', dataType: 'seconds' },
  { name: 'size', dataType: 'elements' },
  { name: 'encoding', dataType: 'string' },
  { name: 'value', dataType: 'preview' },
];

/** How much of a value to read for the preview column. */
const PREVIEW_ELEMENTS = 8;
const PREVIEW_CHARS = 200;

export class RedisClient implements DatabaseClient {
  readonly engine = 'redis' as const;
  readonly capabilities = REDIS_CAPABILITIES;

  private client: RedisClientType | null = null;

  constructor(private readonly config: ConnectionConfig) {}

  private require(): RedisClientType {
    if (!this.client) throw new Error('Not connected');
    return this.client;
  }

  private assertWritable(): void {
    if (this.config.readOnly) throw new Error('This connection is read-only.');
  }

  async connect(): Promise<void> {
    const { config } = this;

    this.client = createClient({
      socket: {
        host: config.host ?? 'localhost',
        port: config.port ?? 6379,
        ...(config.ssl?.enabled
          ? { tls: true, rejectUnauthorized: config.ssl.rejectUnauthorized }
          : {}),
        connectTimeout: 15_000,
      },
      ...(config.username ? { username: config.username } : {}),
      ...(config.password ? { password: config.password } : {}),
      ...(config.database ? { database: Number(config.database) || 0 } : {}),
    }) as RedisClientType;

    // Without a listener an idle connection error is an unhandled event that
    // would take the host process down.
    this.client.on('error', () => undefined);

    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
    this.client = null;
  }

  async versionString(): Promise<string> {
    const info = await this.require().info('server');
    const version = /redis_version:([^\r\n]+)/.exec(info)?.[1];
    return `Redis ${version ?? 'unknown'}`;
  }

  async ping(): Promise<void> {
    await this.require().ping();
  }

  async listDatabases(): Promise<readonly string[]> {
    // Redis exposes a fixed number of numbered databases; ask the server how
    // many rather than assuming the default sixteen.
    try {
      const config = await this.require().configGet('databases');
      const count = Number(config['databases'] ?? 16);
      return Array.from({ length: count }, (_, index) => String(index));
    } catch {
      return Array.from({ length: 16 }, (_, index) => String(index));
    }
  }

  async listSchemas(): Promise<readonly string[]> {
    return [];
  }

  async listEntities(): Promise<readonly Entity[]> {
    return [
      { name: KEYSPACE, kind: 'collection' },
      { name: SERVER_INFO, kind: 'view' },
    ];
  }

  async listColumns(entity: EntityRef): Promise<readonly Column[]> {
    const fields = entity.name === SERVER_INFO ? INFO_FIELDS : KEY_FIELDS;

    return fields.map((field, index) => ({
      name: field.name,
      dataType: field.dataType ?? 'string',
      nullable: true,
      // The key is what addresses a row, which is what makes editing possible.
      primaryKey: field.name === 'key' || field.name === 'setting',
      ordinal: index,
    }));
  }

  async listIndexes(): Promise<readonly Index[]> {
    return [];
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

  async getProperties(entity: EntityRef): Promise<EntityProperties> {
    if (entity.name !== KEYSPACE) return {};
    return { rowCount: await this.require().dbSize() };
  }

  /**
   * Filtering is pushed down as a SCAN pattern where it can be — a `like` on the
   * key becomes a glob, which is enormously cheaper than reading the keyspace
   * and discarding most of it. Anything else is applied after the scan.
   */
  private scanPattern(filters?: Filters): string {
    if (!filters) return '*';

    if (filters.kind === 'raw') {
      const expression = filters.expression.trim();
      return expression || '*';
    }

    const keyFilter = filters.filters.find(
      (filter) =>
        filter.column === 'key' && (filter.operator === 'like' || filter.operator === '=')
    );
    if (!keyFilter || typeof keyFilter.value !== 'string') return '*';

    return keyFilter.operator === '=' ? keyFilter.value : keyFilter.value.split('%').join('*');
  }

  async selectTop(request: SelectRequest): Promise<Page> {
    if (request.entity.name === SERVER_INFO) return this.readServerInfo(request);

    const client = this.require();
    const pattern = this.scanPattern(request.filters);
    const wanted = request.offset + request.limit;

    // SCAN gives no ordering and no offset, so keys are collected up to the end
    // of the requested page and then sliced. The cursor is followed rather than
    // trusting COUNT, which is only a hint.
    const keys: string[] = [];
    let cursor = '0';

    do {
      const batch = await client.scan(cursor, { MATCH: pattern, COUNT: 500 });
      cursor = String(batch.cursor);
      keys.push(...batch.keys.map(String));
    } while (cursor !== '0' && keys.length < wanted);

    const page = keys.slice(request.offset, wanted);
    const rows = await Promise.all(page.map((key) => this.describeKey(key)));
    const encoded = encodeRows(rows);

    return { rows: encoded, fields: tagFields([...KEY_FIELDS], encoded) };
  }

  /** Everything the keyspace view shows about one key. */
  private async describeKey(key: string): Promise<Record<string, unknown>> {
    const client = this.require();
    const type = await client.type(key);
    const ttl = await client.ttl(key);

    let size: number | null = null;
    // Every branch of the switch below sets this, including the default.
    let preview: string;

    switch (type) {
      case 'string': {
        const value = (await client.get(key)) ?? '';
        size = value.length;
        preview = truncate(value);
        break;
      }
      case 'list': {
        size = await client.lLen(key);
        preview = describeList(await client.lRange(key, 0, PREVIEW_ELEMENTS - 1));
        break;
      }
      case 'set': {
        size = await client.sCard(key);
        preview = describeList(await client.sRandMemberCount(key, PREVIEW_ELEMENTS));
        break;
      }
      case 'zset': {
        size = await client.zCard(key);
        preview = describeList(await client.zRange(key, 0, PREVIEW_ELEMENTS - 1));
        break;
      }
      case 'hash': {
        size = await client.hLen(key);
        const entries = Object.entries(await client.hGetAll(key)).slice(0, PREVIEW_ELEMENTS);
        preview = truncate(entries.map(([field, value]) => `${field}: ${value}`).join(', '));
        break;
      }
      case 'stream': {
        size = await client.xLen(key);
        preview = `${size} entries`;
        break;
      }
      default:
        preview = '';
    }

    let encoding: string | null = null;
    try {
      encoding = String(await client.objectEncoding(key));
    } catch {
      // OBJECT ENCODING is unavailable on some managed instances.
    }

    return {
      key,
      type,
      // -1 means no expiry and -2 means the key vanished between calls; both
      // are more useful shown as nothing than as a negative number of seconds.
      ttl: ttl >= 0 ? ttl : null,
      size,
      encoding,
      value: preview,
    };
  }

  private async readServerInfo(request: SelectRequest): Promise<Page> {
    const info = await this.require().info();

    const rows = info
      .split(/\r?\n/)
      .filter((line) => line.includes(':') && !line.startsWith('#'))
      .map((line) => {
        const [setting, ...rest] = line.split(':');
        return { setting: setting ?? '', value: rest.join(':') };
      })
      .slice(request.offset, request.offset + request.limit);

    const encoded = encodeRows(rows);
    return { rows: encoded, fields: tagFields([...INFO_FIELDS], encoded) };
  }

  async selectTopSql(request: SelectRequest): Promise<string> {
    const pattern = this.scanPattern(request.filters);
    return `SCAN 0 MATCH ${pattern} COUNT ${request.limit}`;
  }

  async count(entity: EntityRef): Promise<number> {
    if (entity.name !== KEYSPACE) return 0;
    return this.require().dbSize();
  }

  /**
   * The editor runs Redis commands, not SQL. Each line is one command, which
   * matches how redis-cli behaves and keeps multi-command scripts readable.
   */
  async query(text: string, options: QueryOptions): Promise<readonly ResultSet[]> {
    const client = this.require();
    const results: ResultSet[] = [];

    for (const line of text.split(/\r?\n/)) {
      const command = line.trim();
      if (!command || command.startsWith('#')) continue;

      const parts = tokenize(command);
      const name = parts[0];
      if (!name) continue;

      if (this.config.readOnly && !READ_ONLY_COMMANDS.has(name.toUpperCase())) {
        throw new Error(`This connection is read-only, so ${name.toUpperCase()} is refused.`);
      }

      const started = performance.now();
      const reply = await client.sendCommand(parts);
      const durationMs = performance.now() - started;

      const rows = encodeRows(replyToRows(reply));
      results.push({
        fields: tagFields(
          rows.length > 0 ? Object.keys(rows[0]!).map((name_) => ({ name: name_ })) : [],
          rows
        ),
        rows: rows.slice(0, options.maxRows),
        truncated: rows.length > options.maxRows,
        rowCount: rows.length,
        statement: command,
        durationMs,
      });
    }

    return results;
  }

  async stream(request: StreamRequest): Promise<Cursor> {
    const client = this.require();
    const pattern = this.scanPattern(request.filters);

    let cursor = '0';
    let exhausted = false;
    const describe = this.describeKey.bind(this);

    return {
      fields: [...KEY_FIELDS],
      async read() {
        if (exhausted) return [];

        const batch = await client.scan(cursor, { MATCH: pattern, COUNT: request.chunkSize });
        cursor = String(batch.cursor);
        if (cursor === '0') exhausted = true;

        return encodeRows(await Promise.all(batch.keys.map((key) => describe(String(key)))));
      },
      async close() {
        exhausted = true;
      },
    };
  }

  async resolveEditability(
    _text: string,
    fields: readonly Field[]
  ): Promise<readonly FieldEditability[]> {
    const readOnly = this.config.readOnly ?? false;

    return fields.map((field) => {
      if (readOnly) {
        return { field: field.name, editable: false, reason: 'read-only-connection' as const };
      }
      // Only a string value and its expiry are editable in place; changing a
      // list or hash means editing an element, which the value inspector does.
      if (field.name === 'value' || field.name === 'ttl') {
        return {
          field: field.name,
          editable: true,
          source: { entity: { name: KEYSPACE }, column: field.name },
        };
      }
      return { field: field.name, editable: false, reason: 'unsupported' as const };
    });
  }

  async applyChanges(changes: ChangeSet): Promise<void> {
    this.assertWritable();
    const client = this.require();

    for (const update of changes.updates) {
      const key = String(update.primaryKeys.find((pk) => pk.column === 'key')?.value ?? '');
      if (!key) throw new Error('Cannot update a Redis value without its key.');

      if (update.column === 'value') {
        const type = await client.type(key);
        if (type !== 'string') {
          throw new Error(
            `Editing a ${type} in place is not supported; edit its elements instead.`
          );
        }
        await client.set(key, String(update.value ?? ''));
        continue;
      }

      if (update.column === 'ttl') {
        // Clearing the cell removes the expiry rather than setting it to zero,
        // which would delete the key immediately.
        if (update.value === null || update.value === '') await client.persist(key);
        else await client.expire(key, Number(update.value));
        continue;
      }

      throw new Error(`The ${update.column} column cannot be edited.`);
    }

    for (const remove of changes.deletes) {
      const key = String(remove.primaryKeys.find((pk) => pk.column === 'key')?.value ?? '');
      if (key) await client.del(key);
    }

    for (const insert of changes.inserts) {
      const key = String(insert.values['key'] ?? '');
      if (!key) throw new Error('A new key needs a name.');
      await client.set(key, String(insert.values['value'] ?? ''));
    }
  }

  async applyChangesSql(changes: ChangeSet): Promise<string> {
    const lines: string[] = [];

    for (const insert of changes.inserts) {
      lines.push(`SET ${insert.values['key']} ${JSON.stringify(insert.values['value'] ?? '')}`);
    }
    for (const update of changes.updates) {
      const key = update.primaryKeys.find((pk) => pk.column === 'key')?.value;
      lines.push(
        update.column === 'ttl'
          ? `EXPIRE ${key} ${update.value}`
          : `SET ${key} ${JSON.stringify(update.value ?? '')}`
      );
    }
    for (const remove of changes.deletes) {
      lines.push(`DEL ${remove.primaryKeys.find((pk) => pk.column === 'key')?.value}`);
    }

    return lines.join('\n');
  }

  async beginTransaction(): Promise<void> {
    throw new Error('Redis does not support interactive transactions.');
  }

  async commitTransaction(): Promise<void> {
    throw new Error('Redis does not support interactive transactions.');
  }

  async rollbackTransaction(): Promise<void> {
    throw new Error('Redis does not support interactive transactions.');
  }

  quoteIdentifier(value: string): string {
    return value;
  }
}

const INFO_FIELDS: readonly Field[] = [
  { name: 'setting', dataType: 'string' },
  { name: 'value', dataType: 'string' },
];

/** Commands that cannot modify data, for enforcing read-only connections. */
const READ_ONLY_COMMANDS = new Set([
  'GET',
  'MGET',
  'STRLEN',
  'EXISTS',
  'TYPE',
  'TTL',
  'PTTL',
  'KEYS',
  'SCAN',
  'RANDOMKEY',
  'HGET',
  'HGETALL',
  'HKEYS',
  'HVALS',
  'HLEN',
  'HMGET',
  'HSCAN',
  'HEXISTS',
  'LRANGE',
  'LLEN',
  'LINDEX',
  'SMEMBERS',
  'SCARD',
  'SISMEMBER',
  'SSCAN',
  'SRANDMEMBER',
  'ZRANGE',
  'ZCARD',
  'ZSCORE',
  'ZSCAN',
  'ZCOUNT',
  'ZRANK',
  'XLEN',
  'XRANGE',
  'XREVRANGE',
  'INFO',
  'DBSIZE',
  'PING',
  'OBJECT',
  'MEMORY',
  'CONFIG',
]);

/** Splits a command line, honouring quoted arguments with spaces in them. */
function tokenize(command: string): string[] {
  const tokens: string[] = [];
  const pattern = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+)/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(command)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '');
  }

  return tokens;
}

/** Shapes an arbitrary Redis reply into rows the grid can show. */
function replyToRows(reply: unknown): Record<string, unknown>[] {
  if (reply === null || reply === undefined) return [];

  if (Array.isArray(reply)) {
    if (reply.length === 0) return [];
    // An array of scalars is a list of values; an array of arrays is a table.
    if (Array.isArray(reply[0])) {
      return reply.map((row) =>
        Object.fromEntries((row as unknown[]).map((value, index) => [`col${index + 1}`, value]))
      );
    }
    return reply.map((value, index) => ({ index: index + 1, value: asText(value) }));
  }

  if (typeof reply === 'object') {
    return Object.entries(reply as Record<string, unknown>).map(([field, value]) => ({
      field,
      value: asText(value),
    }));
  }

  return [{ reply: asText(reply) }];
}

function asText(value: unknown): string {
  if (value instanceof Buffer) return value.toString('utf8');
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

function truncate(value: string): string {
  return value.length > PREVIEW_CHARS ? `${value.slice(0, PREVIEW_CHARS)}…` : value;
}

function describeList(values: readonly unknown[]): string {
  return truncate(values.map(asText).join(', '));
}
