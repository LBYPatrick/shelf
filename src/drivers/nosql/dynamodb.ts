import {
  DescribeTableCommand,
  DynamoDBClient as AwsDynamoDBClient,
  ListTablesCommand,
} from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  ExecuteStatementCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
  type ScanCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { fromIni } from '@aws-sdk/credential-providers';
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
 * DynamoDB is a key-value store with a query language bolted on, and its
 * constraints are unusually sharp:
 *
 *  - There is no server-side sort except along a table's sort key, so column
 *    sorting is not offered rather than silently sorting one page.
 *  - Paging is by exclusive start key, not offset.
 *  - Counting means scanning the whole table, which costs real money.
 *
 * All three are declared, so the interface simply does not show controls that
 * would be lies.
 */
const DYNAMO_CAPABILITIES = capabilities({
  sql: false,
  queryLanguage: 'partiql',
  schemas: false,
  // "Databases" are regions, and switching region means a new client.
  multipleDatabases: false,
  transactions: false,
  relations: false,
  triggers: false,
  views: false,
  routines: false,
  comments: false,
  ddl: false,
  sortPushdown: 'none',
  filterPushdown: 'partial',
  cheapCount: false,
  sshTunnel: false,
  nouns: { database: 'region', entity: 'table', row: 'item', column: 'attribute' },
});

/** Items sampled to infer a table's attributes beyond its declared key. */
const SAMPLE_SIZE = 50;

export class DynamodbClient implements DatabaseClient {
  readonly engine = 'dynamodb' as const;
  readonly capabilities = DYNAMO_CAPABILITIES;

  private raw: AwsDynamoDBClient | null = null;
  private client: DynamoDBDocumentClient | null = null;
  /** Start keys per table, so paging forward does not rescan. */
  private readonly startKeys = new Map<string, (Record<string, unknown> | undefined)[]>();

  constructor(private readonly config: ConnectionConfig) {}

  private require(): DynamoDBDocumentClient {
    if (!this.client) throw new Error('Not connected');
    return this.client;
  }

  private assertWritable(): void {
    if (this.config.readOnly) throw new Error('This connection is read-only.');
  }

  private get region(): string {
    return String(this.config.options?.['region'] ?? 'us-east-1');
  }

  async connect(): Promise<void> {
    const options = this.config.options ?? {};
    const endpoint = String(options['endpoint'] ?? '');
    const authType = String(options['authType'] ?? 'profile');

    const credentials =
      authType === 'keys'
        ? {
            accessKeyId: String(options['accessKeyId'] ?? ''),
            secretAccessKey: String(options['secretAccessKey'] ?? ''),
          }
        : authType === 'profile'
          ? fromIni({ profile: String(options['profile'] ?? 'default') })
          : // 'environment' lets the SDK's default chain find credentials.
            undefined;

    this.raw = new AwsDynamoDBClient({
      region: this.region,
      ...(endpoint ? { endpoint } : {}),
      ...(credentials ? { credentials } : {}),
      // A local endpoint needs credentials present but does not check them.
      ...(endpoint && !credentials
        ? { credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
        : {}),
    });

    this.client = DynamoDBDocumentClient.from(this.raw, {
      marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
    });

    // Confirm the credentials and region actually work before reporting success.
    await this.client.send(new ListTablesCommand({ Limit: 1 }));
  }

  async disconnect(): Promise<void> {
    this.client?.destroy();
    this.raw?.destroy();
    this.client = null;
    this.raw = null;
    this.startKeys.clear();
  }

  async versionString(): Promise<string> {
    return `DynamoDB (${this.region})`;
  }

  async ping(): Promise<void> {
    await this.require().send(new ListTablesCommand({ Limit: 1 }));
  }

  async listDatabases(): Promise<readonly string[]> {
    return [this.region];
  }

  async listSchemas(): Promise<readonly string[]> {
    return [];
  }

  async listEntities(): Promise<readonly Entity[]> {
    const names: string[] = [];
    let startTable: string | undefined;

    // The listing is paged, and a busy account has more than one page.
    do {
      const result = await this.require().send(
        new ListTablesCommand({
          ...(startTable ? { ExclusiveStartTableName: startTable } : {}),
        })
      );
      names.push(...(result.TableNames ?? []));
      startTable = result.LastEvaluatedTableName;
    } while (startTable);

    return names.sort().map((name) => ({ name, kind: 'table' as const }));
  }

  async listColumns(entity: EntityRef): Promise<readonly Column[]> {
    const described = await this.require().send(
      new DescribeTableCommand({ TableName: entity.name })
    );

    const table = described.Table;
    const keySchema = table?.KeySchema ?? [];
    const keyNames = new Set(keySchema.map((key) => key.AttributeName ?? ''));

    // Only key attributes are declared; everything else exists per item, so the
    // rest of the shape is inferred from a sample.
    const declared = new Map<string, string>(
      (table?.AttributeDefinitions ?? []).map((definition) => [
        definition.AttributeName ?? '',
        attributeTypeName(definition.AttributeType ?? 'S'),
      ])
    );

    const sample = await this.require().send(
      new ScanCommand({ TableName: entity.name, Limit: SAMPLE_SIZE })
    );

    const inferred = new Map<string, Set<string>>();
    for (const item of sample.Items ?? []) {
      for (const [name, value] of Object.entries(item)) {
        const types = inferred.get(name) ?? new Set<string>();
        types.add(jsType(value));
        inferred.set(name, types);
      }
    }

    const names = new Set([...declared.keys(), ...inferred.keys()]);

    return [...names]
      .sort((a, b) => (keyNames.has(a) ? -1 : keyNames.has(b) ? 1 : a.localeCompare(b)))
      .map((name, index) => ({
        name,
        dataType:
          declared.get(name) ?? [...(inferred.get(name) ?? ['unknown'])].sort().join(' | '),
        nullable: !keyNames.has(name),
        primaryKey: keyNames.has(name),
        ordinal: index,
      }));
  }

  async listIndexes(entity: EntityRef): Promise<readonly Index[]> {
    const described = await this.require().send(
      new DescribeTableCommand({ TableName: entity.name })
    );
    const table = described.Table;

    const primary: Index = {
      name: 'primary',
      columns: (table?.KeySchema ?? []).map((key) => key.AttributeName ?? ''),
      unique: true,
      primary: true,
    };

    const secondary = [
      ...(table?.GlobalSecondaryIndexes ?? []).map((index) => ({
        name: index.IndexName ?? '',
        columns: (index.KeySchema ?? []).map((key) => key.AttributeName ?? ''),
        unique: false,
        primary: false,
        type: 'global',
      })),
      ...(table?.LocalSecondaryIndexes ?? []).map((index) => ({
        name: index.IndexName ?? '',
        columns: (index.KeySchema ?? []).map((key) => key.AttributeName ?? ''),
        unique: false,
        primary: false,
        type: 'local',
      })),
    ];

    return [primary, ...secondary];
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
    const described = await this.require().send(
      new DescribeTableCommand({ TableName: entity.name })
    );

    return {
      // The item count is updated roughly every six hours, so it is an estimate
      // — but an estimate that costs nothing, unlike a real count.
      rowCount: described.Table?.ItemCount ?? 0,
      dataSizeBytes: described.Table?.TableSizeBytes ?? 0,
    };
  }

  /** Turns the shared filter model into a DynamoDB filter expression. */
  private buildFilter(filters?: Filters): {
    FilterExpression?: string;
    ExpressionAttributeNames?: Record<string, string>;
    ExpressionAttributeValues?: Record<string, unknown>;
  } {
    if (!filters || (filters.kind === 'builder' && filters.filters.length === 0)) return {};

    if (filters.kind === 'raw') {
      const expression = filters.expression.trim();
      return expression ? { FilterExpression: expression } : {};
    }

    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const parts: string[] = [];

    filters.filters.forEach((filter, index) => {
      // Attribute names are aliased because a great many useful words —
      // "name", "status", "size" — are reserved.
      const nameKey = `#n${index}`;
      const valueKey = `:v${index}`;
      names[nameKey] = filter.column;

      let part: string;
      switch (filter.operator) {
        case 'is null':
          part = `attribute_not_exists(${nameKey})`;
          break;
        case 'is not null':
          part = `attribute_exists(${nameKey})`;
          break;
        case 'like':
          values[valueKey] = String(filter.value).split('%').join('');
          part = `contains(${nameKey}, ${valueKey})`;
          break;
        case 'not like':
          values[valueKey] = String(filter.value).split('%').join('');
          part = `NOT contains(${nameKey}, ${valueKey})`;
          break;
        case 'in':
        case 'not in': {
          const list = Array.isArray(filter.value) ? filter.value : [filter.value];
          const keys = list.map((value, position) => {
            const key = `${valueKey}_${position}`;
            values[key] = value;
            return key;
          });
          part = `${filter.operator === 'in' ? '' : 'NOT '}${nameKey} IN (${keys.join(', ')})`;
          break;
        }
        default:
          values[valueKey] = filter.value;
          part = `${nameKey} ${filter.operator} ${valueKey}`;
      }

      parts.push(index === 0 ? part : `${(filter.join ?? 'and').toUpperCase()} ${part}`);
    });

    return {
      FilterExpression: parts.join(' '),
      ExpressionAttributeNames: names,
      ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
    };
  }

  async selectTop(request: SelectRequest): Promise<Page> {
    const key = `${request.entity.name}:${JSON.stringify(request.filters ?? null)}`;
    const starts = this.startKeys.get(key) ?? [undefined];
    const pageIndex = Math.floor(request.offset / Math.max(request.limit, 1));

    const result: ScanCommandOutput = await this.require().send(
      new ScanCommand({
        TableName: request.entity.name,
        Limit: request.limit,
        ...(starts[pageIndex] ? { ExclusiveStartKey: starts[pageIndex] } : {}),
        ...this.buildFilter(request.filters),
      })
    );

    const next = [...starts];
    next[pageIndex + 1] = result.LastEvaluatedKey;
    this.startKeys.set(key, next);

    const items = (result.Items ?? []) as Record<string, unknown>[];
    const rows = encodeRows(items);

    return {
      rows,
      fields: tagFields(
        attributeNames(items).map((name) => ({ name })),
        rows
      ),
    };
  }

  async selectTopSql(request: SelectRequest): Promise<string> {
    const filter = this.buildFilter(request.filters);
    return filter.FilterExpression
      ? `SELECT * FROM "${request.entity.name}" WHERE ${filter.FilterExpression}`
      : `SELECT * FROM "${request.entity.name}"`;
  }

  async count(entity: EntityRef, filters?: Filters): Promise<number> {
    // A real count is a full scan; it is only reached when the user asks for it
    // explicitly, because `cheapCount` is false.
    let total = 0;
    let startKey: Record<string, unknown> | undefined;

    do {
      const result: ScanCommandOutput = await this.require().send(
        new ScanCommand({
          TableName: entity.name,
          Select: 'COUNT',
          ...(startKey ? { ExclusiveStartKey: startKey } : {}),
          ...this.buildFilter(filters),
        })
      );
      total += result.Count ?? 0;
      startKey = result.LastEvaluatedKey;
    } while (startKey);

    return total;
  }

  /** The editor runs PartiQL, which is what DynamoDB itself accepts. */
  async query(text: string, options: QueryOptions): Promise<readonly ResultSet[]> {
    const results: ResultSet[] = [];

    for (const statement of text
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)) {
      if (this.config.readOnly && !/^\s*select\b/i.test(statement)) {
        throw new Error('This connection is read-only.');
      }

      const started = performance.now();
      const items: Record<string, unknown>[] = [];
      let nextToken: string | undefined;

      do {
        const result = await this.require().send(
          new ExecuteStatementCommand({
            Statement: statement,
            ...(nextToken ? { NextToken: nextToken } : {}),
          })
        );
        items.push(...((result.Items ?? []) as Record<string, unknown>[]));
        nextToken = result.NextToken;
      } while (nextToken && items.length < options.maxRows);

      const durationMs = performance.now() - started;
      const truncated = items.length > options.maxRows;
      const rows = encodeRows(truncated ? items.slice(0, options.maxRows) : items);

      results.push({
        fields: tagFields(
          attributeNames(items).map((name) => ({ name })),
          rows
        ),
        rows,
        truncated,
        rowCount: items.length,
        statement,
        durationMs,
      });
    }

    return results;
  }

  async stream(request: StreamRequest): Promise<Cursor> {
    const client = this.require();
    const table = request.entity!.name;
    const filter = this.buildFilter(request.filters);

    let startKey: Record<string, unknown> | undefined;
    let done = false;
    let fields: Field[] = [];

    return {
      get fields() {
        return fields;
      },
      async read() {
        if (done) return [];

        const result: ScanCommandOutput = await client.send(
          new ScanCommand({
            TableName: table,
            Limit: request.chunkSize,
            ...(startKey ? { ExclusiveStartKey: startKey } : {}),
            ...filter,
          })
        );

        startKey = result.LastEvaluatedKey;
        if (!startKey) done = true;

        const items = (result.Items ?? []) as Record<string, unknown>[];
        if (fields.length === 0) fields = attributeNames(items).map((name) => ({ name }));

        return encodeRows(items);
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

    const table = /\bfrom\s+"?([\w.-]+)"?/i.exec(text)?.[1];
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
      // The key identifies the item; changing it would mean writing a different
      // item, not editing this one.
      if (keys.has(field.name)) {
        return { field: field.name, editable: false, reason: 'computed-column' as const };
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

    for (const insert of changes.inserts) {
      await client.send(new PutCommand({ TableName: insert.entity.name, Item: insert.values }));
    }

    for (const update of changes.updates) {
      await client.send(
        new UpdateCommand({
          TableName: update.entity.name,
          Key: keyOf(update.primaryKeys),
          // Aliased for the same reason as filters: many ordinary attribute
          // names are reserved words.
          UpdateExpression: 'SET #attribute = :value',
          ExpressionAttributeNames: { '#attribute': update.column },
          ExpressionAttributeValues: { ':value': untagValue(update.value) },
        })
      );
    }

    // Deletes are batched, which is both faster and cheaper than one call each.
    const deletes = changes.deletes.map((remove) => ({
      table: remove.entity.name,
      key: keyOf(remove.primaryKeys),
    }));

    for (let index = 0; index < deletes.length; index += 25) {
      const batch = deletes.slice(index, index + 25);
      const grouped: Record<string, { DeleteRequest: { Key: Record<string, unknown> } }[]> = {};

      for (const entry of batch) {
        (grouped[entry.table] ??= []).push({ DeleteRequest: { Key: entry.key } });
      }

      await client.send(new BatchWriteCommand({ RequestItems: grouped }));
    }
  }

  async applyChangesSql(changes: ChangeSet): Promise<string> {
    const lines: string[] = [];

    for (const insert of changes.inserts) {
      lines.push(`INSERT INTO "${insert.entity.name}" VALUE ${JSON.stringify(insert.values)}`);
    }
    for (const update of changes.updates) {
      lines.push(
        `UPDATE "${update.entity.name}" SET ${update.column} = ${JSON.stringify(untagValue(update.value))} ` +
          `WHERE ${update.primaryKeys.map((k) => `${k.column} = ${JSON.stringify(untagValue(k.value))}`).join(' AND ')}`
      );
    }
    for (const remove of changes.deletes) {
      lines.push(
        `DELETE FROM "${remove.entity.name}" ` +
          `WHERE ${remove.primaryKeys.map((k) => `${k.column} = ${JSON.stringify(untagValue(k.value))}`).join(' AND ')}`
      );
    }

    return lines.join(';\n');
  }

  async beginTransaction(): Promise<void> {
    throw new Error('DynamoDB has no interactive transactions.');
  }

  async commitTransaction(): Promise<void> {
    throw new Error('DynamoDB has no interactive transactions.');
  }

  async rollbackTransaction(): Promise<void> {
    throw new Error('DynamoDB has no interactive transactions.');
  }

  quoteIdentifier(value: string): string {
    return `"${value.split('"').join('""')}"`;
  }
}

/** Deletes and updates need the whole key, partition and sort both. */
function keyOf(keys: readonly { column: string; value: unknown }[]): Record<string, unknown> {
  if (keys.length === 0) throw new Error('Cannot address an item without its key.');
  return Object.fromEntries(keys.map((key) => [key.column, untagValue(key.value)]));
}

function attributeTypeName(code: string): string {
  return { S: 'string', N: 'number', B: 'binary' }[code] ?? code;
}

function jsType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'list';
  if (value instanceof Uint8Array) return 'binary';
  if (value instanceof Set) return 'set';
  if (typeof value === 'object') return 'map';
  return typeof value;
}

function attributeNames(items: readonly Record<string, unknown>[]): string[] {
  const names = new Set<string>();
  for (const item of items) {
    for (const key of Object.keys(item)) names.add(key);
  }
  return [...names];
}
