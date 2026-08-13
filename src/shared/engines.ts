import type { EngineId } from '../drivers/types';

/**
 * What the interface needs to know about an engine before a driver is loaded:
 * how to name it, what to ask the user for, and what to default to.
 *
 * Keeping this declarative means one connection form renders all nine engines
 * instead of nine hand-written forms that drift apart.
 */

export type FieldKind =
  'host' | 'port' | 'username' | 'password' | 'database' | 'file' | 'socket' | 'url';

export interface EngineOption {
  readonly key: string;
  readonly label: string;
  readonly help?: string;
  readonly kind: 'text' | 'password' | 'number' | 'boolean' | 'select';
  readonly choices?: readonly { value: string; label: string }[];
  readonly defaultValue?: string | number | boolean;
  readonly required?: boolean;
}

export interface EngineDescriptor {
  readonly id: EngineId;
  readonly name: string;
  /** Two-letter mark used when no logo is available. */
  readonly mark: string;
  /** The accent hue this engine is associated with, for its chip. */
  readonly hue: number;
  readonly defaultPort?: number;
  /** Which standard fields the form shows, in order. */
  readonly fields: readonly FieldKind[];
  /** Extra engine-specific settings, shown under Advanced. */
  readonly options?: readonly EngineOption[];
  readonly supportsSsl: boolean;
  readonly supportsSsh: boolean;
  /** File extensions offered by the picker, for file-backed engines. */
  readonly fileExtensions?: readonly string[];
  readonly databaseLabel?: string;
}

export const ENGINES: readonly EngineDescriptor[] = [
  {
    id: 'postgres',
    name: 'PostgreSQL',
    mark: 'Pg',
    hue: 230,
    defaultPort: 5432,
    fields: ['host', 'port', 'username', 'password', 'database', 'socket'],
    supportsSsl: true,
    supportsSsh: true,
  },
  {
    id: 'mysql',
    name: 'MySQL',
    mark: 'My',
    hue: 210,
    defaultPort: 3306,
    fields: ['host', 'port', 'username', 'password', 'database', 'socket'],
    supportsSsl: true,
    supportsSsh: true,
  },
  {
    id: 'tidb',
    name: 'TiDB',
    mark: 'Ti',
    hue: 20,
    defaultPort: 4000,
    fields: ['host', 'port', 'username', 'password', 'database'],
    supportsSsl: true,
    supportsSsh: true,
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    mark: 'Sq',
    hue: 200,
    fields: ['file'],
    fileExtensions: ['db', 'sqlite', 'sqlite3', 'db3'],
    supportsSsl: false,
    supportsSsh: false,
  },
  {
    id: 'duckdb',
    name: 'DuckDB',
    mark: 'Dk',
    hue: 75,
    fields: ['file'],
    fileExtensions: ['duckdb', 'ddb'],
    supportsSsl: false,
    supportsSsh: false,
  },
  {
    id: 'mongodb',
    name: 'MongoDB',
    mark: 'Mo',
    hue: 145,
    defaultPort: 27017,
    fields: ['host', 'port', 'username', 'password', 'database', 'url'],
    supportsSsl: true,
    supportsSsh: true,
  },
  {
    id: 'redis',
    name: 'Redis',
    mark: 'Rd',
    hue: 25,
    defaultPort: 6379,
    fields: ['host', 'port', 'username', 'password', 'database'],
    databaseLabel: 'Database index',
    supportsSsl: true,
    supportsSsh: true,
  },
  {
    id: 'scylla',
    name: 'ScyllaDB',
    mark: 'Sc',
    hue: 265,
    defaultPort: 9042,
    fields: ['host', 'port', 'username', 'password', 'database'],
    databaseLabel: 'Keyspace',
    options: [
      {
        key: 'localDataCenter',
        label: 'Local data centre',
        help: 'Required by the driver to route queries; usually datacenter1.',
        kind: 'text',
        defaultValue: 'datacenter1',
        required: true,
      },
    ],
    supportsSsl: true,
    supportsSsh: true,
  },
  {
    id: 'dynamodb',
    name: 'DynamoDB',
    mark: 'Dy',
    hue: 250,
    fields: [],
    databaseLabel: 'Region',
    options: [
      {
        key: 'region',
        label: 'Region',
        kind: 'text',
        defaultValue: 'us-east-1',
        required: true,
      },
      {
        key: 'authType',
        label: 'Credentials',
        kind: 'select',
        defaultValue: 'profile',
        choices: [
          { value: 'profile', label: 'Shared profile' },
          { value: 'keys', label: 'Access key' },
          { value: 'environment', label: 'Environment' },
        ],
      },
      { key: 'profile', label: 'Profile name', kind: 'text', defaultValue: 'default' },
      { key: 'accessKeyId', label: 'Access key ID', kind: 'text' },
      { key: 'secretAccessKey', label: 'Secret access key', kind: 'password' },
      {
        key: 'endpoint',
        label: 'Endpoint',
        help: 'Set this to use DynamoDB Local, e.g. http://localhost:8000',
        kind: 'text',
      },
    ],
    supportsSsl: false,
    supportsSsh: false,
  },
];

/**
 * Sample mode is a real engine to the driver layer but not a choice in the
 * picker — it is offered as its own entry point on the start screen instead.
 */
export const MOCK_ENGINE: EngineDescriptor = {
  id: 'mock',
  name: 'Sample data',
  mark: '◐',
  hue: 285,
  fields: [],
  supportsSsl: false,
  supportsSsh: false,
};

const BY_ID = new Map([...ENGINES, MOCK_ENGINE].map((engine) => [engine.id, engine]));

export function engineDescriptor(id: EngineId): EngineDescriptor {
  const descriptor = BY_ID.get(id);
  if (!descriptor) throw new Error(`Unknown engine: ${id}`);
  return descriptor;
}

/** True when the engine connects to a file rather than a server. */
export function isFileEngine(id: EngineId): boolean {
  return engineDescriptor(id).fields.includes('file');
}
