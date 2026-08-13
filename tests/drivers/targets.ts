import type { ConnectionConfig, EngineId } from '@drivers/types';

/**
 * The databases the conformance suite runs against.
 *
 * Ports match docker-compose.yml and are offset from the defaults so a local
 * Postgres or MySQL already running on this machine is not shadowed.
 */
export interface Target {
  readonly engine: EngineId;
  readonly label: string;
  readonly config: ConnectionConfig;
  /** A table the suite may create and drop. */
  readonly table: string;
}

export const TARGETS: readonly Target[] = [
  {
    engine: 'postgres',
    label: 'PostgreSQL',
    table: 'shelf_conformance',
    config: {
      engine: 'postgres',
      host: '127.0.0.1',
      port: 55432,
      username: 'shelf',
      password: 'shelf',
      database: 'shelf',
    },
  },
  {
    engine: 'mysql',
    label: 'MySQL',
    table: 'shelf_conformance',
    config: {
      engine: 'mysql',
      host: '127.0.0.1',
      port: 53306,
      username: 'root',
      password: 'shelf',
      database: 'shelf',
    },
  },
  {
    engine: 'tidb',
    label: 'TiDB',
    table: 'shelf_conformance',
    config: {
      engine: 'tidb',
      host: '127.0.0.1',
      port: 54000,
      username: 'root',
      database: 'test',
    },
  },
  {
    engine: 'redis',
    label: 'Redis',
    table: 'keys',
    config: { engine: 'redis', host: '127.0.0.1', port: 56379 },
  },
  {
    engine: 'mongodb',
    label: 'MongoDB',
    table: 'shelf_conformance',
    config: {
      engine: 'mongodb',
      host: '127.0.0.1',
      port: 57017,
      username: 'shelf',
      password: 'shelf',
      database: 'shelf',
      url: 'mongodb://shelf:shelf@127.0.0.1:57017/shelf?authSource=admin',
    },
  },
  {
    engine: 'scylla',
    label: 'ScyllaDB',
    table: 'shelf_conformance',
    config: {
      engine: 'scylla',
      host: '127.0.0.1',
      port: 59042,
      database: 'shelf',
      options: { localDataCenter: 'datacenter1' },
    },
  },
  {
    engine: 'dynamodb',
    label: 'DynamoDB',
    table: 'shelf_conformance',
    config: {
      engine: 'dynamodb',
      options: {
        region: 'us-east-1',
        authType: 'keys',
        accessKeyId: 'local',
        secretAccessKey: 'local',
        endpoint: 'http://127.0.0.1:58000',
      },
    },
  },
];
