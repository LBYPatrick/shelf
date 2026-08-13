import { capabilities } from './capabilities';
import { encodeRows, tagFields } from './transcode';
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
} from './types';

/**
 * A database that is not a database.
 *
 * Mock mode exists so the whole interface can be exercised — and designed —
 * without installing anything. That makes it useful well beyond a demo: it is
 * the fastest way to check a layout against realistic data, and it gives the
 * end-to-end tests a fixture that behaves identically on every machine.
 *
 * The data is deliberately awkward in the ways real data is awkward: nulls,
 * empty strings, very long text, JSON, binary, big integers beyond what a
 * double can hold, and dates. A demo made only of tidy short strings would hide
 * exactly the cases the grid has to get right.
 */
const MOCK_CAPABILITIES = capabilities({
  schemas: true,
  multipleDatabases: false,
  partitions: false,
  cheapCount: true,
  sshTunnel: false,
});

interface MockTable {
  readonly name: string;
  readonly schema: string;
  readonly kind: 'table' | 'view';
  readonly columns: readonly Column[];
  readonly rows: readonly Record<string, unknown>[];
  readonly indexes?: readonly Index[];
  readonly relations?: readonly Relation[];
}

/** Deterministic pseudo-randomness, so the sample data is the same every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const random = seeded(20260813);

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(random() * list.length)]!;
}

const ARTISTS = [
  'Talk Talk',
  'Slowdive',
  'Boards of Canada',
  'Sault',
  'Cocteau Twins',
  'Broadcast',
  'Stereolab',
  'Autechre',
  'Portishead',
  'Massive Attack',
  'Aphex Twin',
  'Burial',
  'Cluster',
  'Harmonia',
  'Laurie Spiegel',
  'Alice Coltrane',
  'Arthur Russell',
  'Julia Holter',
];

const COUNTRIES = ['GB', 'US', 'DE', 'JP', 'SE', 'FR', 'CA', null];

const FORMATS = ['LP', 'CD', 'Cassette', 'Digital', '7"'];

function column(name: string, dataType: string, options: Partial<Column> = {}): Column {
  return {
    name,
    dataType,
    nullable: true,
    primaryKey: false,
    ordinal: 0,
    ...options,
  };
}

function buildTables(): MockTable[] {
  const artists = ARTISTS.map((name, index) => ({
    id: index + 1,
    name,
    country: pick(COUNTRIES),
    formed: 1975 + Math.floor(random() * 40),
    // A long biography, so the grid's truncation and the value inspector both
    // have something real to handle.
    biography:
      index % 4 === 0
        ? `${name} formed in the late twentieth century and spent the following decades quietly rearranging what people expected records to sound like. Their early work was dismissed at the time and is now taught. ${'Later reissues added unreleased material. '.repeat(3)}`
        : index % 5 === 0
          ? ''
          : null,
    verified: random() > 0.4,
  }));

  const albums: Record<string, unknown>[] = [];
  let albumId = 1;

  for (const artist of artists) {
    const count = 2 + Math.floor(random() * 5);
    for (let n = 0; n < count; n += 1) {
      albums.push({
        id: albumId,
        artist_id: artist.id,
        title: `${artist.name} vol. ${n + 1}`,
        released: new Date(
          Date.UTC(
            1985 + Math.floor(random() * 38),
            Math.floor(random() * 12),
            1 + Math.floor(random() * 27)
          )
        ),
        tracks: 6 + Math.floor(random() * 12),
        rating: Math.round((2.5 + random() * 2.5) * 10) / 10,
        format: pick(FORMATS),
        // JSON, because a modern schema almost always has some.
        metadata: {
          producer: pick(['self', 'Flood', 'Nigel Godrich', 'Sylvia Massy']),
          reissued: random() > 0.7,
          tags: [
            pick(['ambient', 'dub', 'post-rock', 'minimal']),
            pick(['analogue', 'digital']),
          ],
        },
        // A play count large enough to lose precision as a double.
        play_count: BigInt(
          Math.floor(random() * 9_000_000_000_000_000) +
            9_007_199_254_740_993n.toString().length
        ),
        cover: n === 0 ? Buffer.from(`cover-${albumId}-binary-data`) : null,
        notes: random() > 0.8 ? null : `Catalogue ${1000 + albumId}`,
      });
      albumId += 1;
    }
  }

  const tracks: Record<string, unknown>[] = [];
  let trackId = 1;

  for (const album of albums.slice(0, 40)) {
    const count = Number(album['tracks']);
    for (let position = 1; position <= count; position += 1) {
      tracks.push({
        id: trackId,
        album_id: album['id'],
        position,
        title: `Untitled ${position}`,
        seconds: 90 + Math.floor(random() * 500),
        explicit: random() > 0.9,
      });
      trackId += 1;
    }
  }

  return [
    {
      name: 'artist',
      schema: 'music',
      kind: 'table',
      columns: [
        column('id', 'integer', { primaryKey: true, nullable: false, ordinal: 0 }),
        column('name', 'text', { nullable: false, ordinal: 1 }),
        column('country', 'char(2)', { ordinal: 2 }),
        column('formed', 'integer', { ordinal: 3 }),
        column('biography', 'text', { ordinal: 4 }),
        column('verified', 'boolean', { ordinal: 5, defaultValue: 'false' }),
      ],
      rows: artists,
      indexes: [
        { name: 'artist_pkey', columns: ['id'], unique: true, primary: true, type: 'btree' },
        {
          name: 'artist_name_idx',
          columns: ['name'],
          unique: false,
          primary: false,
          type: 'btree',
        },
      ],
      relations: [
        {
          name: 'album_artist_id_fkey',
          direction: 'incoming',
          columns: ['id'],
          referencedTable: { name: 'album', schema: 'music' },
          referencedColumns: ['artist_id'],
        },
      ],
    },
    {
      name: 'album',
      schema: 'music',
      kind: 'table',
      columns: [
        column('id', 'integer', { primaryKey: true, nullable: false, ordinal: 0 }),
        column('artist_id', 'integer', { nullable: false, ordinal: 1 }),
        column('title', 'text', { nullable: false, ordinal: 2 }),
        column('released', 'date', { ordinal: 3 }),
        column('tracks', 'smallint', { ordinal: 4 }),
        column('rating', 'numeric(2,1)', { ordinal: 5 }),
        column('format', 'text', { ordinal: 6 }),
        column('metadata', 'jsonb', { ordinal: 7 }),
        column('play_count', 'bigint', { ordinal: 8 }),
        column('cover', 'bytea', { ordinal: 9 }),
        column('notes', 'text', { ordinal: 10 }),
      ],
      rows: albums,
      indexes: [
        { name: 'album_pkey', columns: ['id'], unique: true, primary: true, type: 'btree' },
        {
          name: 'album_artist_idx',
          columns: ['artist_id'],
          unique: false,
          primary: false,
          type: 'btree',
        },
        {
          name: 'album_title_key',
          columns: ['artist_id', 'title'],
          unique: true,
          primary: false,
          type: 'btree',
        },
      ],
      relations: [
        {
          name: 'album_artist_id_fkey',
          direction: 'outgoing',
          columns: ['artist_id'],
          referencedTable: { name: 'artist', schema: 'music' },
          referencedColumns: ['id'],
          onDelete: 'CASCADE',
        },
        {
          name: 'track_album_id_fkey',
          direction: 'incoming',
          columns: ['id'],
          referencedTable: { name: 'track', schema: 'music' },
          referencedColumns: ['album_id'],
        },
      ],
    },
    {
      name: 'track',
      schema: 'music',
      kind: 'table',
      columns: [
        column('id', 'integer', { primaryKey: true, nullable: false, ordinal: 0 }),
        column('album_id', 'integer', { nullable: false, ordinal: 1 }),
        column('position', 'smallint', { nullable: false, ordinal: 2 }),
        column('title', 'text', { ordinal: 3 }),
        column('seconds', 'integer', { ordinal: 4 }),
        column('explicit', 'boolean', { ordinal: 5 }),
      ],
      rows: tracks,
      indexes: [
        { name: 'track_pkey', columns: ['id'], unique: true, primary: true, type: 'btree' },
      ],
      relations: [
        {
          name: 'track_album_id_fkey',
          direction: 'outgoing',
          columns: ['album_id'],
          referencedTable: { name: 'album', schema: 'music' },
          referencedColumns: ['id'],
          onDelete: 'CASCADE',
        },
      ],
    },
    {
      name: 'catalogue',
      schema: 'music',
      kind: 'view',
      columns: [
        column('artist', 'text', { ordinal: 0 }),
        column('title', 'text', { ordinal: 1 }),
        column('released', 'date', { ordinal: 2 }),
      ],
      rows: albums.slice(0, 60).map((album) => ({
        artist: artists.find((artist) => artist.id === album['artist_id'])?.name ?? null,
        title: album['title'],
        released: album['released'],
      })),
    },
    {
      /*
       * Deliberately wider than any pane it will be shown in. A table with more
       * columns than fit is its own category of problem — the header has to
       * scroll with the body, the row has to stay one row, and the first column
       * has to remain findable — and none of the other sample tables exercise
       * it.
       */
      name: 'daily_metrics',
      schema: 'ops',
      kind: 'table',
      columns: [
        column('id', 'bigint', { primaryKey: true, nullable: false, ordinal: 0 }),
        column('captured_on', 'date', { nullable: false, ordinal: 1 }),
        column('region', 'text', { ordinal: 2 }),
        column('listeners_total', 'integer', { ordinal: 3 }),
        column('listeners_new', 'integer', { ordinal: 4 }),
        column('listeners_returning', 'integer', { ordinal: 5 }),
        column('streams_started', 'bigint', { ordinal: 6 }),
        column('streams_completed', 'bigint', { ordinal: 7 }),
        column('skip_rate', 'numeric(5,4)', { ordinal: 8 }),
        column('average_session_seconds', 'integer', { ordinal: 9 }),
        column('peak_concurrent', 'integer', { ordinal: 10 }),
        column('revenue_gross_cents', 'bigint', { ordinal: 11 }),
        column('revenue_net_cents', 'bigint', { ordinal: 12 }),
        column('refunds_cents', 'bigint', { ordinal: 13 }),
        column('subscription_conversions', 'integer', { ordinal: 14 }),
        column('churned_subscribers', 'integer', { ordinal: 15 }),
        column('support_tickets_opened', 'integer', { ordinal: 16 }),
        column('notes', 'text', { ordinal: 17 }),
      ],
      rows: Array.from({ length: 180 }, (_, index) => {
        const total = 40_000 + Math.floor(random() * 60_000);
        const started = total * (3 + Math.floor(random() * 4));
        const gross = Math.floor(random() * 900_000);
        return {
          id: index + 1,
          captured_on: new Date(Date.now() - index * 86_400_000),
          region: pick(['eu-west', 'us-east', 'us-west', 'ap-south', 'sa-east']),
          listeners_total: total,
          listeners_new: Math.floor(total * 0.08),
          listeners_returning: Math.floor(total * 0.92),
          streams_started: started,
          streams_completed: Math.floor(started * 0.83),
          skip_rate: Number((random() * 0.3).toFixed(4)),
          average_session_seconds: 600 + Math.floor(random() * 2400),
          peak_concurrent: Math.floor(total * 0.11),
          revenue_gross_cents: gross,
          revenue_net_cents: Math.floor(gross * 0.7),
          refunds_cents: Math.floor(random() * 4000),
          subscription_conversions: Math.floor(random() * 400),
          churned_subscribers: Math.floor(random() * 120),
          support_tickets_opened: Math.floor(random() * 60),
          notes: pick([null, 'campaign launch', 'partial outage in ap-south', '']),
        };
      }),
      indexes: [
        {
          name: 'daily_metrics_pkey',
          columns: ['id'],
          unique: true,
          primary: true,
          type: 'btree',
        },
      ],
    },
    {
      name: 'audit_log',
      schema: 'ops',
      kind: 'table',
      columns: [
        column('id', 'bigint', { primaryKey: true, nullable: false, ordinal: 0 }),
        column('at', 'timestamptz', { nullable: false, ordinal: 1 }),
        column('actor', 'text', { ordinal: 2 }),
        column('action', 'text', { ordinal: 3 }),
        column('payload', 'jsonb', { ordinal: 4 }),
      ],
      rows: Array.from({ length: 220 }, (_, index) => ({
        id: index + 1,
        at: new Date(Date.now() - index * 3_600_000),
        actor: pick(['sam', 'ada', 'system', null]),
        action: pick(['insert', 'update', 'delete', 'login']),
        payload: { table: pick(['album', 'artist', 'track']), rows: Math.floor(random() * 40) },
      })),
    },
  ];
}

export class MockClient implements DatabaseClient {
  readonly engine = 'mock' as const;
  readonly capabilities = MOCK_CAPABILITIES;

  private readonly tables = buildTables();

  constructor(private readonly config: ConnectionConfig) {}

  private find(entity: EntityRef): MockTable {
    const table = this.tables.find(
      (candidate) =>
        candidate.name === entity.name && (!entity.schema || candidate.schema === entity.schema)
    );
    if (!table) throw new Error(`No such table: ${entity.name}`);
    return table;
  }

  async connect(): Promise<void> {
    // A brief pause so the connecting state is visible rather than a flash.
    await new Promise((resolve) => setTimeout(resolve, 180));
  }

  async disconnect(): Promise<void> {}

  async versionString(): Promise<string> {
    return 'Sample data (no database)';
  }

  async ping(): Promise<void> {}

  async listDatabases(): Promise<readonly string[]> {
    return ['sample'];
  }

  async listSchemas(): Promise<readonly string[]> {
    return [...new Set(this.tables.map((table) => table.schema))].sort();
  }

  async listEntities(schema?: string): Promise<readonly Entity[]> {
    return this.tables
      .filter((table) => !schema || table.schema === schema)
      .map((table) => ({ name: table.name, schema: table.schema, kind: table.kind }));
  }

  async listColumns(entity: EntityRef): Promise<readonly Column[]> {
    return this.find(entity).columns;
  }

  async listIndexes(entity: EntityRef): Promise<readonly Index[]> {
    return this.find(entity).indexes ?? [];
  }

  async listRelations(entity: EntityRef): Promise<readonly Relation[]> {
    return this.find(entity).relations ?? [];
  }

  async listTriggers(): Promise<readonly Trigger[]> {
    return [];
  }

  async listPartitions(): Promise<readonly Partition[]> {
    return [];
  }

  async getProperties(entity: EntityRef): Promise<EntityProperties> {
    const table = this.find(entity);
    return {
      rowCount: table.rows.length,
      dataSizeBytes: table.rows.length * 320,
      indexSizeBytes: (table.indexes?.length ?? 0) * 8192,
    };
  }

  /** Applies the raw filter as a case-insensitive match across every column. */
  private filtered(table: MockTable, filters?: Filters): readonly Record<string, unknown>[] {
    if (!filters) return table.rows;

    const needle =
      filters.kind === 'raw'
        ? filters.expression.trim().toLowerCase()
        : filters.filters
            .map((filter) => String(filter.value ?? ''))
            .join(' ')
            .toLowerCase();

    if (!needle) return table.rows;

    return table.rows.filter((row) =>
      Object.values(row).some((value) =>
        String(value ?? '')
          .toLowerCase()
          .includes(needle)
      )
    );
  }

  async selectTop(request: SelectRequest): Promise<Page> {
    const table = this.find(request.entity);
    const rows = [...this.filtered(table, request.filters)];

    for (const order of [...(request.orderBy ?? [])].reverse()) {
      rows.sort((a, b) => {
        const left = a[order.column];
        const right = b[order.column];
        if (left === right) return 0;
        if (left === null || left === undefined) return 1;
        if (right === null || right === undefined) return -1;
        const comparison = left < right ? -1 : 1;
        return order.direction === 'desc' ? -comparison : comparison;
      });
    }

    const page = rows.slice(request.offset, request.offset + request.limit);
    const encoded = encodeRows(page);

    return {
      rows: encoded,
      fields: tagFields(
        table.columns.map((column) => ({ name: column.name, dataType: column.dataType })),
        encoded
      ),
      totalRowCount: rows.length,
    };
  }

  async selectTopSql(request: SelectRequest): Promise<string> {
    return `SELECT * FROM ${request.entity.schema}.${request.entity.name} LIMIT ${request.limit} OFFSET ${request.offset}`;
  }

  async count(entity: EntityRef, filters?: Filters): Promise<number> {
    return this.filtered(this.find(entity), filters).length;
  }

  /**
   * Answers a query by recognising the table named after FROM. It is not a SQL
   * engine and does not pretend to be — anything it cannot recognise says so
   * plainly rather than returning something misleading.
   */
  async query(text: string, options: QueryOptions): Promise<readonly ResultSet[]> {
    const started = performance.now();
    const match = /\bfrom\s+(?:(\w+)\.)?(\w+)/i.exec(text);

    if (!match) {
      return [
        {
          fields: [{ name: 'result' }],
          rows: encodeRows([{ result: 'Sample mode understands SELECT … FROM <table>.' }]),
          truncated: false,
          rowCount: 1,
          statement: text,
          durationMs: performance.now() - started,
        },
      ];
    }

    const table = this.find({
      name: match[2]!,
      ...(match[1] ? { schema: match[1] } : {}),
    });

    const limit = /\blimit\s+(\d+)/i.exec(text);
    const rows = table.rows.slice(
      0,
      Math.min(Number(limit?.[1] ?? options.maxRows), options.maxRows)
    );
    const encoded = encodeRows(rows);

    return [
      {
        fields: tagFields(
          table.columns.map((column) => ({ name: column.name, dataType: column.dataType })),
          encoded
        ),
        rows: encoded,
        truncated: rows.length < table.rows.length,
        rowCount: table.rows.length,
        statement: text,
        durationMs: performance.now() - started,
      },
    ];
  }

  async stream(request: StreamRequest): Promise<Cursor> {
    const table = this.find(request.entity!);
    const rows = this.filtered(table, request.filters);
    let offset = 0;

    const fields: Field[] = table.columns.map((column) => ({
      name: column.name,
      dataType: column.dataType,
    }));

    return {
      fields,
      async read() {
        if (offset >= rows.length) return [];
        const chunk = rows.slice(offset, offset + request.chunkSize);
        offset += chunk.length;
        return encodeRows(chunk);
      },
      async close() {
        offset = rows.length;
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

    const match = /\bfrom\s+(?:\w+\.)?(\w+)/i.exec(text);
    if (!match) {
      return fields.map((field) => ({
        field: field.name,
        editable: false,
        reason: 'no-linked-table' as const,
      }));
    }

    return fields.map((field) => ({
      field: field.name,
      editable: field.name !== 'id',
      ...(field.name === 'id' ? { reason: 'computed-column' as const } : {}),
    }));
  }

  async applyChanges(changes: ChangeSet): Promise<void> {
    // Edits are accepted and held in memory, so the pending-changes ledger and
    // the apply flow can be exercised. Nothing is written anywhere.
    for (const update of changes.updates) {
      const table = this.find(update.entity);
      const key = update.primaryKeys[0];
      if (!key) continue;

      const row = table.rows.find(
        (candidate) => String(candidate[key.column]) === String(key.value)
      );
      if (row) (row as Record<string, unknown>)[update.column] = update.value;
    }
  }

  async applyChangesSql(changes: ChangeSet): Promise<string> {
    return changes.updates
      .map(
        (update) =>
          `UPDATE ${update.entity.name} SET ${update.column} = … WHERE ${update.primaryKeys
            .map((key) => `${key.column} = ${String(key.value)}`)
            .join(' AND ')};`
      )
      .join('\n');
  }

  async beginTransaction(): Promise<void> {}
  async commitTransaction(): Promise<void> {}
  async rollbackTransaction(): Promise<void> {}

  quoteIdentifier(value: string): string {
    return `"${value}"`;
  }
}
