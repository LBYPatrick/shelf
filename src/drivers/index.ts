import { registerEngine } from './registry';

/**
 * Registers every engine Shelf ships.
 *
 * Each driver is imported on first use: between them the nine clients pull in
 * tens of megabytes of native modules and cloud SDKs, and loading all of them to
 * open one SQLite file would make the connection host slow to start for no
 * benefit.
 */
export function registerEngines(): void {
  registerEngine('sqlite', async () => {
    const { SqliteClient } = await import('./sql/sqlite');
    return (config) => new SqliteClient(config);
  });

  registerEngine('postgres', async () => {
    const { PostgresClient } = await import('./sql/postgres');
    return (config) => new PostgresClient(config);
  });

  registerEngine('mysql', async () => {
    const { MysqlClient } = await import('./sql/mysql');
    return (config) => new MysqlClient(config);
  });

  // TiDB speaks the MySQL wire protocol, so it shares the driver entirely; the
  // separate id exists so version reporting and feature detection can tell them
  // apart.
  registerEngine('tidb', async () => {
    const { MysqlClient } = await import('./sql/mysql');
    return (config) => new MysqlClient(config, 'tidb');
  });

  registerEngine('duckdb', async () => {
    const { DuckdbClient } = await import('./sql/duckdb');
    return (config) => new DuckdbClient(config);
  });

  registerEngine('redis', async () => {
    const { RedisClient } = await import('./nosql/redis');
    return (config) => new RedisClient(config);
  });

  registerEngine('mongodb', async () => {
    const { MongodbClient } = await import('./nosql/mongodb');
    return (config) => new MongodbClient(config);
  });

  registerEngine('scylla', async () => {
    const { ScyllaClient } = await import('./nosql/scylla');
    return (config) => new ScyllaClient(config);
  });

  // Sample mode is bundled rather than lazy: it is the fallback when nothing
  // else is installed, and it pulls in nothing.
  registerEngine('mock', async () => {
    const { MockClient } = await import('./mock');
    return (config) => new MockClient(config);
  });

  registerEngine('dynamodb', async () => {
    const { DynamodbClient } = await import('./nosql/dynamodb');
    return (config) => new DynamodbClient(config);
  });
}
