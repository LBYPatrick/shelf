import { describe, expect, it } from 'vitest';
import { looksLikeUrl, parseConnectionUrl } from '@shared/connectionUrl';

describe('connection urls', () => {
  it('reads a full postgres url', () => {
    const parsed = parseConnectionUrl('postgres://sam:s3cret@db.example.com:6432/orders');
    expect(parsed?.engine).toBe('postgres');
    expect(parsed?.config.host).toBe('db.example.com');
    expect(parsed?.config.port).toBe(6432);
    expect(parsed?.config.username).toBe('sam');
    expect(parsed?.config.database).toBe('orders');
    expect(parsed?.password).toBe('s3cret');
    expect(parsed?.suggestedName).toBe('db.example.com/orders');
  });

  it('fills in the default port when the url omits it', () => {
    expect(parseConnectionUrl('mysql://root@localhost/shop')?.config.port).toBe(3306);
    expect(parseConnectionUrl('redis://localhost')?.config.port).toBe(6379);
  });

  it('decodes credentials that were percent-encoded', () => {
    const parsed = parseConnectionUrl('postgres://a%40b:p%40ss@host/db');
    expect(parsed?.config.username).toBe('a@b');
    expect(parsed?.password).toBe('p@ss');
  });

  it('turns sslmode=require into an SSL configuration', () => {
    expect(parseConnectionUrl('postgres://h/db?sslmode=require')?.config.ssl?.enabled).toBe(
      true
    );
  });

  it('treats the rediss scheme as TLS', () => {
    expect(parseConnectionUrl('rediss://cache.example.com')?.config.ssl?.enabled).toBe(true);
  });

  it('keeps a mongodb+srv url whole, because its hosts come from DNS', () => {
    const parsed = parseConnectionUrl('mongodb+srv://u:p@cluster.mongodb.net/app');
    expect(parsed?.engine).toBe('mongodb');
    expect(parsed?.config.url).toContain('mongodb+srv://');
    expect(parsed?.config.port).toBeUndefined();
  });

  it('recognises a bare path as a file-backed database', () => {
    expect(parseConnectionUrl('/data/app.sqlite')?.engine).toBe('sqlite');
    expect(parseConnectionUrl('/data/analytics.duckdb')?.engine).toBe('duckdb');
    expect(parseConnectionUrl('/data/app.sqlite')?.config.filePath).toBe('/data/app.sqlite');
  });

  it('names a file connection after the file', () => {
    expect(parseConnectionUrl('/var/db/orders.db')?.suggestedName).toBe('orders.db');
  });

  it('maps every alias to its engine', () => {
    expect(parseConnectionUrl('postgresql://h/d')?.engine).toBe('postgres');
    expect(parseConnectionUrl('mariadb://h/d')?.engine).toBe('mysql');
    expect(parseConnectionUrl('cassandra://h/k')?.engine).toBe('scylla');
    expect(parseConnectionUrl('tidb://h/d')?.engine).toBe('tidb');
  });

  it('returns nothing for text that is not a connection string', () => {
    expect(parseConnectionUrl('users')).toBeUndefined();
    expect(parseConnectionUrl('http://example.com')).toBeUndefined();
    expect(parseConnectionUrl('')).toBeUndefined();
  });

  it('recognises what is worth trying to parse', () => {
    expect(looksLikeUrl('postgres://x')).toBe(true);
    expect(looksLikeUrl('/data/a.db')).toBe(true);
    expect(looksLikeUrl('album')).toBe(false);
  });
});
