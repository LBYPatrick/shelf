import type {
  Capabilities,
  Column,
  Entity,
  Field,
  Index,
  Relation,
  ResultSet,
  Row,
  Trigger,
} from '@drivers/types';
import type { SavedConnection } from '@shared/connections';
import type { LiveConnection } from '@renderer/stores/connections';

/**
 * One sample database, for every story that needs one.
 *
 * Written out rather than imported from `src/drivers/mock.ts`, for the reason
 * the architecture rules give: the renderer never imports a driver, and a
 * storybook is the renderer. It is also the better source — a story wants a
 * table with a null in it, a column with a comment, a name long enough to
 * truncate, and a relation in both directions, and those are properties of a
 * *fixture* rather than of a sample dataset someone browses.
 *
 * The shapes are the real ones from `drivers/types`, so a change to the model
 * breaks these at compile time rather than leaving stories quietly describing a
 * database that can no longer exist.
 */

export const CAPABILITIES: Capabilities = {
  sql: true,
  queryLanguage: 'sql',
  schemas: true,
  multipleDatabases: true,
  transactions: true,
  indexes: true,
  relations: true,
  triggers: true,
  partitions: false,
  views: true,
  routines: true,
  comments: true,
  ddl: true,
  sortPushdown: 'full',
  filterPushdown: 'full',
  cheapCount: true,
  streaming: true,
  sshTunnel: true,
  nativeShell: false,
  containers: true,
  statistics: true,
  nouns: { database: 'database', entity: 'table', row: 'row', column: 'column' },
};

/** A store whose nouns are its own, for stories about engine differences. */
export const MONGO_CAPABILITIES: Capabilities = {
  ...CAPABILITIES,
  sql: false,
  queryLanguage: 'javascript',
  schemas: false,
  indexes: true,
  relations: false,
  triggers: false,
  routines: false,
  ddl: false,
  statistics: false,
  nouns: { database: 'database', entity: 'collection', row: 'document', column: 'field' },
};

export const ENTITIES: Entity[] = [
  { name: 'artist', schema: 'music', kind: 'table', comment: 'Everyone who made something.' },
  { name: 'album', schema: 'music', kind: 'table' },
  { name: 'track', schema: 'music', kind: 'table' },
  { name: 'catalogue', schema: 'music', kind: 'view' },
  { name: 'top_sellers', schema: 'music', kind: 'materialized-view' },
  { name: 'daily_metrics', schema: 'ops', kind: 'table' },
  { name: 'audit_log', schema: 'ops', kind: 'table' },
  {
    // Long enough to truncate wherever a name is drawn in a fixed column.
    name: 'quarterly_revenue_by_region_and_channel',
    schema: 'ops',
    kind: 'table',
  },
  { name: 'recalculate_totals', schema: 'ops', kind: 'routine', routineType: 'procedure' },
];

const column = (
  name: string,
  dataType: string,
  ordinal: number,
  over: Partial<Column> = {}
): Column => ({ name, dataType, nullable: true, primaryKey: false, ordinal, ...over });

export const COLUMNS: Record<string, Column[]> = {
  'music.artist': [
    column('id', 'integer', 1, { nullable: false, primaryKey: true }),
    column('name', 'text', 2, { nullable: false }),
    column('country', 'char(2)', 3, { comment: 'ISO 3166-1 alpha-2.' }),
    column('formed', 'integer', 4),
    column('biography', 'text', 5),
    column('verified', 'boolean', 6, { defaultValue: 'false' }),
  ],
  'music.album': [
    column('id', 'integer', 1, { nullable: false, primaryKey: true }),
    column('artist_id', 'integer', 2, { nullable: false }),
    column('title', 'text', 3, { nullable: false }),
    column('released', 'date', 4),
    column('runtime_seconds', 'integer', 5, { generated: true }),
  ],
  'music.track': [
    column('id', 'integer', 1, { nullable: false, primaryKey: true }),
    column('album_id', 'integer', 2, { nullable: false }),
    column('title', 'text', 3, { nullable: false }),
    column('play_count', 'bigint', 4, { defaultValue: '0' }),
  ],
  'ops.daily_metrics': [
    column('day', 'date', 1, { nullable: false, primaryKey: true }),
    column('plays', 'bigint', 2, { nullable: false }),
    column('revenue', 'numeric(12,2)', 3),
  ],
};

export const INDEXES: Record<string, Index[]> = {
  'music.artist': [
    { name: 'artist_pkey', columns: ['id'], unique: true, primary: true, type: 'btree' },
    { name: 'artist_name_idx', columns: ['name'], unique: false, primary: false, type: 'btree' },
  ],
  'music.album': [
    { name: 'album_pkey', columns: ['id'], unique: true, primary: true, type: 'btree' },
    {
      name: 'album_artist_released_idx',
      columns: ['artist_id', 'released'],
      unique: false,
      primary: false,
      type: 'btree',
    },
  ],
};

export const RELATIONS: Record<string, Relation[]> = {
  'music.album': [
    {
      name: 'album_artist_fk',
      direction: 'outgoing',
      columns: ['artist_id'],
      referencedTable: { name: 'artist', schema: 'music' },
      referencedColumns: ['id'],
      onDelete: 'CASCADE',
    },
    {
      name: 'track_album_fk',
      direction: 'incoming',
      columns: ['id'],
      referencedTable: { name: 'track', schema: 'music' },
      referencedColumns: ['album_id'],
    },
  ],
  'music.artist': [
    {
      name: 'album_artist_fk',
      direction: 'incoming',
      columns: ['id'],
      referencedTable: { name: 'album', schema: 'music' },
      referencedColumns: ['artist_id'],
    },
  ],
};

export const TRIGGERS: Record<string, Trigger[]> = {
  'music.album': [
    {
      name: 'album_touch_updated',
      timing: 'BEFORE',
      event: 'UPDATE',
      statement: 'EXECUTE FUNCTION touch_updated_at()',
    },
  ],
};

export const FIELDS: Field[] = [
  { name: 'id', dataType: 'integer' },
  { name: 'title', dataType: 'text' },
  { name: 'released', dataType: 'date', tag: 'date' },
  { name: 'runtime_seconds', dataType: 'integer' },
  { name: 'notes', dataType: 'text' },
];

/** Rows with the awkward values in them: a null, a long string, a date, a big number. */
export const ROWS: Row[] = [
  {
    id: 1,
    title: 'Kind of Blue',
    released: { $: 'date', data: '1959-08-17T00:00:00.000Z' },
    runtime_seconds: 2585,
    notes: null,
  },
  {
    id: 2,
    title: 'The Dark Side of the Moon',
    released: { $: 'date', data: '1973-03-01T00:00:00.000Z' },
    runtime_seconds: 2580,
    notes: 'Remastered in 2011; the original master is the one on the shelf.',
  },
  {
    id: 3,
    title: 'In a Silent Way',
    released: { $: 'date', data: '1969-07-30T00:00:00.000Z' },
    runtime_seconds: 2238,
    notes: null,
  },
  {
    id: 4,
    title: 'A Love Supreme',
    released: { $: 'date', data: '1965-01-01T00:00:00.000Z' },
    runtime_seconds: 1968,
    notes: 'Four parts, one take.',
  },
  {
    id: 5,
    title: 'Unknown Pleasures',
    released: null,
    runtime_seconds: 2358,
    notes: null,
  },
];

export const RESULT: ResultSet = {
  fields: FIELDS,
  rows: ROWS,
  truncated: false,
  rowCount: ROWS.length,
  statement: 'select id, title, released, runtime_seconds, notes from music.album',
  durationMs: 12,
};

export const SAVED_CONNECTIONS: SavedConnection[] = [
  {
    id: 'conn-local',
    name: 'Local Postgres',
    engine: 'postgres',
    folderId: null,
    position: 0,
    labelColor: '#4f8cf5',
    pinned: true,
    readOnly: false,
    rememberSecrets: true,
    config: { engine: 'postgres', host: 'localhost', port: 5432, database: 'records' },
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    lastUsedAt: 1_700_600_000_000,
  },
  {
    id: 'conn-staging',
    name: 'Staging — read only',
    engine: 'mysql',
    folderId: 'folder-work',
    position: 1,
    labelColor: '#e0a33e',
    pinned: false,
    readOnly: true,
    rememberSecrets: true,
    config: { engine: 'mysql', host: 'staging.internal', port: 3306, database: 'shop' },
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    lastUsedAt: 1_700_500_000_000,
  },
  {
    id: 'conn-analytics',
    name: 'Analytics warehouse',
    engine: 'duckdb',
    folderId: 'folder-work',
    position: 2,
    labelColor: null,
    pinned: false,
    readOnly: false,
    rememberSecrets: false,
    config: { engine: 'duckdb', filePath: '/Users/you/warehouse.duckdb' },
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    lastUsedAt: null,
  },
];

export const FOLDERS = [
  { id: 'folder-work', name: 'Work', parentId: null, position: 0 },
];

export const LIVE_CONNECTION: LiveConnection = {
  id: 'conn-local',
  name: 'Local Postgres',
  engine: 'postgres',
  capabilities: CAPABILITIES,
  version: 'PostgreSQL 17.2',
  labelColor: '#4f8cf5',
  readOnly: false,
  database: 'records',
};

export const key = (name: string, schema?: string) => (schema ? `${schema}.${name}` : name);
