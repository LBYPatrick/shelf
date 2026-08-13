import type { ConnectionConfig, EngineId } from '../drivers/types';

/**
 * Reading a connection string.
 *
 * Most people arrive with a URL already on the clipboard — from a hosting
 * dashboard, a `.env`, a colleague. Parsing it is a far better first move than
 * asking them to disassemble it into six fields by hand.
 */

const SCHEMES: Record<string, EngineId> = {
  postgres: 'postgres',
  postgresql: 'postgres',
  psql: 'postgres',
  mysql: 'mysql',
  mariadb: 'mysql',
  tidb: 'tidb',
  sqlite: 'sqlite',
  file: 'sqlite',
  duckdb: 'duckdb',
  mongodb: 'mongodb',
  'mongodb+srv': 'mongodb',
  redis: 'redis',
  rediss: 'redis',
  cassandra: 'scylla',
  scylla: 'scylla',
  dynamodb: 'dynamodb',
};

const DEFAULT_PORTS: Partial<Record<EngineId, number>> = {
  postgres: 5432,
  mysql: 3306,
  tidb: 4000,
  mongodb: 27017,
  redis: 6379,
  scylla: 9042,
};

export interface ParsedConnection {
  readonly engine: EngineId;
  readonly config: Partial<Omit<ConnectionConfig, 'password'>>;
  readonly password?: string;
  /** A name good enough to save under without asking. */
  readonly suggestedName: string;
}

/** True when the text looks like something worth trying to parse. */
export function looksLikeUrl(text: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(text.trim()) || /^[/~.]/.test(text.trim());
}

export function parseConnectionUrl(input: string): ParsedConnection | undefined {
  const text = input.trim();
  if (!text) return undefined;

  // A bare path is a file-backed database; the extension decides which.
  if (/^[/~.]/.test(text)) {
    const engine: EngineId = /\.(duckdb|ddb)$/i.test(text) ? 'duckdb' : 'sqlite';
    return {
      engine,
      config: { engine, filePath: text },
      suggestedName: text.split(/[\\/]/).pop() ?? text,
    };
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }

  const scheme = url.protocol.replace(':', '').toLowerCase();
  const engine = SCHEMES[scheme];
  if (!engine) return undefined;

  if (engine === 'sqlite' || engine === 'duckdb') {
    const path = decodeURIComponent(url.pathname);
    return {
      engine,
      config: { engine, filePath: path },
      suggestedName: path.split(/[\\/]/).pop() ?? path,
    };
  }

  // Mongo's SRV form carries no port and must keep its URL intact, because the
  // real hosts come from DNS.
  if (scheme === 'mongodb+srv') {
    return {
      engine,
      config: { engine, url: text, host: url.hostname },
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
      suggestedName: url.hostname,
    };
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const port = url.port ? Number(url.port) : DEFAULT_PORTS[engine];

  const config: Partial<Omit<ConnectionConfig, 'password'>> = {
    engine,
    host: url.hostname || 'localhost',
    ...(port ? { port } : {}),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(database ? { database } : {}),
    // `sslmode=require` and the `rediss:` scheme both mean the same thing.
    ...(url.searchParams.get('sslmode') === 'require' || scheme === 'rediss'
      ? { ssl: { enabled: true, rejectUnauthorized: true } }
      : {}),
  };

  return {
    engine,
    config,
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    suggestedName: database ? `${url.hostname}/${database}` : url.hostname,
  };
}
