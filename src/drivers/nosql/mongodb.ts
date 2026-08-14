import { MongoClient, ObjectId, type Collection, type Db, type Document } from 'mongodb';
import { capabilities } from '../capabilities';
import { encodeRows, tagFields, untagValue } from '../transcode';
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
 * MongoDB is document-oriented, so it gets a document-oriented interface rather
 * than a SQL veneer. There is no attempt to translate SQL into aggregation
 * pipelines: the editor speaks the language the database actually speaks, which
 * is what anyone reaching for a Mongo client already knows.
 */
const MONGO_CAPABILITIES = capabilities({
  sql: false,
  queryLanguage: 'javascript',
  schemas: false,
  transactions: false,
  relations: false,
  triggers: false,
  views: true,
  routines: false,
  comments: false,
  ddl: false,
  // Sorting and filtering are fully server-side, they are just not SQL.
  sortPushdown: 'full',
  filterPushdown: 'full',
  cheapCount: true,
  nativeShell: true,
  nouns: {
    database: 'database',
    entity: 'collection',
    row: 'document',
    column: 'field',
  },
});

/** Documents sampled to infer a collection's shape. */
const SAMPLE_SIZE = 100;

export class MongodbClient implements DatabaseClient {
  readonly engine = 'mongodb' as const;
  readonly capabilities = MONGO_CAPABILITIES;

  private client: MongoClient | null = null;
  private database: Db | null = null;

  constructor(private readonly config: ConnectionConfig) {}

  private db(): Db {
    if (!this.database) throw new Error('Not connected');
    return this.database;
  }

  private collection(entity: EntityRef): Collection {
    return this.db().collection(entity.name);
  }

  private assertWritable(): void {
    if (this.config.readOnly) throw new Error('This connection is read-only.');
  }

  async connect(): Promise<void> {
    const { config } = this;

    const url =
      config.url ??
      (() => {
        const auth = config.username
          ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password ?? '')}@`
          : '';
        return `mongodb://${auth}${config.host ?? 'localhost'}:${config.port ?? 27017}`;
      })();

    this.client = new MongoClient(url, {
      serverSelectionTimeoutMS: 15_000,
      ...(config.ssl?.enabled
        ? { tls: true, tlsAllowInvalidCertificates: !config.ssl.rejectUnauthorized }
        : {}),
    });

    await this.client.connect();
    this.database = this.client.db(config.database || undefined);

    // `connect` resolves before the server is confirmed reachable, so a bad
    // host would otherwise only fail later, on the first real query.
    await this.database.command({ ping: 1 });
  }

  async disconnect(): Promise<void> {
    await this.client?.close().catch(() => undefined);
    this.client = null;
    this.database = null;
  }

  async versionString(): Promise<string> {
    const info = await this.db().admin().serverInfo();
    return `MongoDB ${info['version'] ?? 'unknown'}`;
  }

  async ping(): Promise<void> {
    await this.db().command({ ping: 1 });
  }

  async listDatabases(): Promise<readonly string[]> {
    const result = await this.db().admin().listDatabases();
    return result.databases.map((entry) => entry.name);
  }

  async listSchemas(): Promise<readonly string[]> {
    return [];
  }

  async listEntities(): Promise<readonly Entity[]> {
    const collections = await this.db().listCollections().toArray();

    return collections.map((info) => ({
      name: info.name,
      kind: info.type === 'view' ? ('view' as const) : ('collection' as const),
    }));
  }

  /**
   * A collection has no declared schema, so its fields are inferred by sampling.
   * The sample is random rather than the first N documents: taking the head of
   * an insertion-ordered collection would describe how the data looked when the
   * application was first written, not how it looks now.
   */
  async listColumns(entity: EntityRef): Promise<readonly Column[]> {
    const sample = await this.collection(entity)
      .aggregate([{ $sample: { size: SAMPLE_SIZE } }])
      .toArray();

    const seen = new Map<string, { types: Set<string>; count: number; ordinal: number }>();

    for (const document of sample) {
      for (const [key, value] of Object.entries(document)) {
        const existing = seen.get(key);
        if (existing) {
          existing.types.add(bsonType(value));
          existing.count += 1;
        } else {
          seen.set(key, { types: new Set([bsonType(value)]), count: 1, ordinal: seen.size });
        }
      }
    }

    return [...seen.entries()]
      .sort(([a], [b]) => (a === '_id' ? -1 : b === '_id' ? 1 : 0))
      .map(([name, info]) => ({
        name,
        // A field with several shapes says so rather than picking one.
        dataType: [...info.types].sort().join(' | '),
        // Anything not in every sampled document is optional in practice.
        nullable: info.count < sample.length,
        primaryKey: name === '_id',
        ordinal: info.ordinal,
      }));
  }

  async listIndexes(entity: EntityRef): Promise<readonly Index[]> {
    const indexes = await this.collection(entity).indexes();

    return indexes.map((index) => ({
      name: String(index.name),
      columns: Object.keys(index.key ?? {}),
      unique: Boolean(index.unique),
      primary: index.name === '_id_',
      ...(index['textIndexVersion'] ? { type: 'text' } : {}),
    }));
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
    try {
      const stats = (await this.db().command({ collStats: entity.name })) as Document;
      return {
        rowCount: Number(stats['count'] ?? 0),
        dataSizeBytes: Number(stats['size'] ?? 0),
        indexSizeBytes: Number(stats['totalIndexSize'] ?? 0),
      };
    } catch {
      return { rowCount: await this.collection(entity).estimatedDocumentCount() };
    }
  }

  /** Turns the shared filter model into a Mongo query document. */
  private toQuery(filters?: Filters): Document {
    if (!filters) return {};

    if (filters.kind === 'raw') {
      const expression = filters.expression.trim();
      if (!expression) return {};
      try {
        return JSON.parse(expression) as Document;
      } catch {
        throw new Error('The filter must be a JSON query document, e.g. {"status": "active"}');
      }
    }

    const conditions = filters.filters.map((filter) => {
      const { column, operator, value } = filter;
      switch (operator) {
        case '=':
          return { [column]: value };
        case '!=':
          return { [column]: { $ne: value } };
        case '<':
          return { [column]: { $lt: value } };
        case '<=':
          return { [column]: { $lte: value } };
        case '>':
          return { [column]: { $gt: value } };
        case '>=':
          return { [column]: { $gte: value } };
        case 'like':
          // The SQL wildcard is translated so the same filter row means the
          // same thing whichever engine is open.
          return { [column]: { $regex: String(value).split('%').join('.*'), $options: 'i' } };
        case 'not like':
          return {
            [column]: { $not: new RegExp(String(value).split('%').join('.*'), 'i') },
          };
        case 'in':
          return { [column]: { $in: Array.isArray(value) ? value : [value] } };
        case 'not in':
          return { [column]: { $nin: Array.isArray(value) ? value : [value] } };
        case 'is null':
          return { [column]: null };
        case 'is not null':
          return { [column]: { $ne: null } };
      }
    });

    if (conditions.length === 0) return {};
    if (conditions.length === 1) return conditions[0]!;

    // Mongo cannot mix and/or in one flat document, so the whole set takes the
    // join of the second filter — matching how the builder reads left to right.
    const join = filters.filters[1]?.join ?? 'and';
    return join === 'or' ? { $or: conditions } : { $and: conditions };
  }

  async selectTop(request: SelectRequest): Promise<Page> {
    const query = this.toQuery(request.filters);

    const projection = request.select?.length
      ? Object.fromEntries(request.select.map((field) => [field, 1]))
      : undefined;

    const sort = request.orderBy?.length
      ? Object.fromEntries(
          request.orderBy.map((order) => [order.column, order.direction === 'desc' ? -1 : 1])
        )
      : undefined;

    const documents = await this.collection(request.entity)
      .find(query, { ...(projection ? { projection } : {}) })
      .sort(sort ?? {})
      .skip(request.offset)
      .limit(request.limit)
      .toArray();

    const rows = encodeRows(documents as Record<string, unknown>[]);
    const names = fieldNames(documents);

    return {
      rows,
      fields: tagFields(
        names.map((name) => ({ name })),
        rows
      ),
      totalRowCount: await this.collection(request.entity).countDocuments(query),
    };
  }

  async selectTopSql(request: SelectRequest): Promise<string> {
    const query = JSON.stringify(this.toQuery(request.filters));
    const sort = request.orderBy?.length
      ? `.sort(${JSON.stringify(
          Object.fromEntries(
            request.orderBy.map((order) => [order.column, order.direction === 'desc' ? -1 : 1])
          )
        )})`
      : '';
    return `db.${request.entity.name}.find(${query})${sort}.skip(${request.offset}).limit(${request.limit})`;
  }

  async count(entity: EntityRef, filters?: Filters): Promise<number> {
    return this.collection(entity).countDocuments(this.toQuery(filters));
  }

  /**
   * The editor accepts `db.<collection>.<method>(<arguments>)`, which is the
   * form people write in the Mongo shell. It is parsed rather than evaluated:
   * running arbitrary JavaScript against the user's database from a text box is
   * a much larger surface than this needs.
   */
  async query(text: string, options: QueryOptions): Promise<readonly ResultSet[]> {
    const results: ResultSet[] = [];

    for (const line of splitCalls(text)) {
      const call = parseCall(line);
      if (!call) {
        throw new Error(
          `Could not read "${line.slice(0, 60)}". Expected db.<collection>.<method>(...)`
        );
      }

      if (this.config.readOnly && !READ_METHODS.has(call.method)) {
        throw new Error(`This connection is read-only, so ${call.method} is refused.`);
      }

      const started = performance.now();
      const documents = await this.runCall(call, options.maxRows);
      const durationMs = performance.now() - started;

      const rows = encodeRows(documents);
      results.push({
        fields: tagFields(
          fieldNames(documents).map((name) => ({ name })),
          rows
        ),
        rows,
        truncated: documents.length > options.maxRows,
        rowCount: documents.length,
        statement: line,
        durationMs,
      });
    }

    return results;
  }

  private async runCall(
    call: { collection: string; method: string; args: unknown[] },
    maxRows: number
  ): Promise<Record<string, unknown>[]> {
    const collection = this.db().collection(call.collection);
    const [first, second] = call.args as [Document | undefined, Document | undefined];

    switch (call.method) {
      case 'find':
        return (await collection
          .find(first ?? {}, second ? { projection: second } : {})
          .limit(maxRows + 1)
          .toArray()) as Record<string, unknown>[];

      case 'findOne': {
        const document = await collection.findOne(first ?? {});
        return document ? [document as Record<string, unknown>] : [];
      }

      case 'aggregate':
        return (await collection
          .aggregate((first as unknown as Document[]) ?? [])
          .limit(maxRows + 1)
          .toArray()) as Record<string, unknown>[];

      case 'countDocuments':
        return [{ count: await collection.countDocuments(first ?? {}) }];

      case 'distinct':
        return (await collection.distinct(String(first ?? ''), second ?? {})).map((value) => ({
          value,
        }));

      case 'insertOne': {
        const result = await collection.insertOne((first ?? {}) as Document);
        return [{ insertedId: result.insertedId }];
      }

      case 'insertMany': {
        const result = await collection.insertMany((first as unknown as Document[]) ?? []);
        return [{ insertedCount: result.insertedCount }];
      }

      case 'updateOne':
      case 'updateMany': {
        const result = await collection[call.method](first ?? {}, second ?? {});
        return [{ matched: result.matchedCount, modified: result.modifiedCount }];
      }

      case 'deleteOne':
      case 'deleteMany': {
        const result = await collection[call.method](first ?? {});
        return [{ deleted: result.deletedCount }];
      }

      default:
        throw new Error(`Unsupported method: ${call.method}`);
    }
  }

  async stream(request: StreamRequest): Promise<Cursor> {
    const collection = this.collection(request.entity!);
    const query = this.toQuery(request.filters);

    const cursor = collection.find(query).batchSize(request.chunkSize);
    let fields: Field[] = [];
    let done = false;

    return {
      get fields() {
        return fields;
      },
      async read() {
        if (done) return [];

        const chunk: Document[] = [];
        while (chunk.length < request.chunkSize && (await cursor.hasNext())) {
          const next = await cursor.next();
          if (next) chunk.push(next);
        }

        if (chunk.length < request.chunkSize) done = true;
        if (fields.length === 0) fields = fieldNames(chunk).map((name) => ({ name }));

        return encodeRows(chunk as Record<string, unknown>[]);
      },
      async close() {
        done = true;
        await cursor.close();
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

    const call = parseCall(text);
    // An aggregation can reshape documents arbitrarily, so its output cannot be
    // written back to a field of the original collection.
    if (!call || call.method === 'aggregate' || call.method === 'distinct') {
      return fields.map((field) => ({
        field: field.name,
        editable: false,
        reason: 'no-linked-table' as const,
      }));
    }

    const entity = { name: call.collection };
    return fields.map((field) => ({
      field: field.name,
      editable: field.name !== '_id',
      ...(field.name === '_id'
        ? { reason: 'computed-column' as const }
        : { source: { entity, column: field.name } }),
    }));
  }

  async applyChanges(changes: ChangeSet): Promise<void> {
    this.assertWritable();

    for (const insert of changes.inserts) {
      await this.collection(insert.entity).insertOne(insert.values as Document);
    }

    for (const update of changes.updates) {
      await this.collection(update.entity).updateOne(this.identify(update.primaryKeys), {
        $set: { [update.column]: untagValue(update.value) },
      });
    }

    for (const remove of changes.deletes) {
      await this.collection(remove.entity).deleteOne(this.identify(remove.primaryKeys));
    }
  }

  /** Builds the `_id` filter that addresses exactly one document. */
  private identify(keys: readonly { column: string; value: unknown }[]): Document {
    const id = keys.find((key) => key.column === '_id');
    if (!id) throw new Error('Cannot address a document without its _id.');

    const value = untagValue(id.value);
    // An ObjectId arrives as its hex string; matching on the string would not
    // find the document, because the stored value is the binary form.
    if (typeof value === 'string' && ObjectId.isValid(value)) {
      return { _id: new ObjectId(value) };
    }
    return { _id: value };
  }

  async applyChangesSql(changes: ChangeSet): Promise<string> {
    const lines: string[] = [];

    for (const insert of changes.inserts) {
      lines.push(`db.${insert.entity.name}.insertOne(${JSON.stringify(insert.values)})`);
    }
    for (const update of changes.updates) {
      const id = update.primaryKeys.find((key) => key.column === '_id')?.value;
      lines.push(
        `db.${update.entity.name}.updateOne({"_id": ${JSON.stringify(untagValue(id))}}, ` +
          `{"$set": {${JSON.stringify(update.column)}: ${JSON.stringify(untagValue(update.value))}}})`
      );
    }
    for (const remove of changes.deletes) {
      const id = remove.primaryKeys.find((key) => key.column === '_id')?.value;
      lines.push(
        `db.${remove.entity.name}.deleteOne({"_id": ${JSON.stringify(untagValue(id))}})`
      );
    }

    return lines.join('\n');
  }

  async beginTransaction(): Promise<void> {
    throw new Error('Interactive transactions are not available on this connection.');
  }

  async commitTransaction(): Promise<void> {
    throw new Error('Interactive transactions are not available on this connection.');
  }

  async rollbackTransaction(): Promise<void> {
    throw new Error('Interactive transactions are not available on this connection.');
  }

  quoteIdentifier(value: string): string {
    return value;
  }
}

/** Methods that cannot modify data, for enforcing read-only connections. */
const READ_METHODS = new Set(['find', 'findOne', 'aggregate', 'countDocuments', 'distinct']);

function bsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'date';
  if (value instanceof ObjectId) return 'objectId';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'double';
  if (typeof value === 'object') return 'object';
  return typeof value;
}

/** Every field seen across the documents, in first-seen order. */
function fieldNames(documents: readonly Document[]): string[] {
  const names = new Set<string>();
  for (const document of documents) {
    for (const key of Object.keys(document)) names.add(key);
  }
  return [...names];
}

/** Splits a script into statements on newlines, ignoring blanks and comments. */
function splitCalls(text: string): string[] {
  return text
    .split(/\r?\n(?=\s*db\.)/)
    .map((line) => line.trim().replace(/;$/, ''))
    .filter((line) => line.length > 0 && !line.startsWith('//'));
}

/**
 * Reads `db.collection.method(args)`. Arguments are parsed as JSON5-ish: keys
 * are quoted first so the shell's unquoted-key style works, which is how these
 * are written in practice.
 */
function parseCall(
  text: string
): { collection: string; method: string; args: unknown[] } | undefined {
  const match = /^\s*db\s*\.\s*([\w$.-]+)\s*\.\s*(\w+)\s*\(([\s\S]*)\)\s*$/.exec(text.trim());
  if (!match) return undefined;

  const [, collection, method, rawArgs] = match;
  if (!collection || !method) return undefined;

  const args = rawArgs?.trim() ? parseArguments(rawArgs) : [];
  return { collection, method, args };
}

function parseArguments(raw: string): unknown[] {
  const parsed = tryParse(`[${raw}]`);
  if (parsed) return parsed as unknown[];

  // Retry with unquoted object keys quoted, which is how the shell is written.
  const quoted = raw.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":');
  const retried = tryParse(`[${quoted}]`);
  if (retried) return retried as unknown[];

  throw new Error('Could not read the arguments. They must be valid JSON.');
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text.replace(/'/g, '"'));
  } catch {
    return undefined;
  }
}
