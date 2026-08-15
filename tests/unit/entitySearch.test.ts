import { describe, expect, it } from 'vitest';
import { parseQuery, qualifiedPath, scoreEntity, searchEntities } from '@shared/entitySearch';

const TABLES = [
  { database: 'sample', schema: 'music', name: 'album' },
  { database: 'sample', schema: 'music', name: 'album_summary' },
  { database: 'sample', schema: 'music', name: 'artist' },
  { database: 'sample', schema: 'ops', name: 'audit_log' },
  { database: 'sample', schema: 'ops', name: 'daily_metrics' },
];

const names = (query: string) => searchEntities(TABLES, query).map((table) => table.name);

describe('searching by name', () => {
  it('finds by subsequence, the way people type when aiming', () => {
    expect(names('albsum')).toEqual(['album_summary']);
  });

  it('ranks the tighter, shorter match first', () => {
    expect(names('album')[0]).toBe('album');
  });

  /*
   * One word asks "anything called this", so a schema's name finds the tables
   * inside it. Binding a single segment to the table alone made typing a
   * schema return nothing, which reads as a broken search rather than a strict
   * one.
   */
  it('matches a level above the table when given a single word', () => {
    expect(names('music')).toEqual(['album', 'album_summary', 'artist']);
    expect(names('sample')).toHaveLength(TABLES.length);
  });

  it('still ranks a hit on the table name above one on its schema', () => {
    // `a` is in every schema here, so the tables whose *names* match come first.
    expect(names('album')[0]).toBe('album');
  });

  it('returns everything for an empty query', () => {
    expect(names('')).toHaveLength(TABLES.length);
    expect(names('   ')).toHaveLength(TABLES.length);
  });
});

describe('dot notation', () => {
  it('reads the last segment as the table and the one before as its schema', () => {
    expect(names('music.album')).toEqual(['album', 'album_summary']);
    expect(names('ops.audit')).toEqual(['audit_log']);
  });

  it('takes a third segment as the database', () => {
    expect(names('sample.music.artist')).toEqual(['artist']);
  });

  /*
   * The point of binding segments to levels rather than searching the whole
   * path: a qualifier that matches nothing has to rule the row out, or the
   * notation is decoration on a plain substring search.
   */
  it('finds nothing when a qualifier does not match', () => {
    expect(names('ops.album')).toEqual([]);
    expect(names('nowhere.music.album')).toEqual([]);
  });

  it('refuses a query deeper than the path itself', () => {
    expect(names('a.b.c.d')).toEqual([]);
  });

  it('ignores empty segments, so a trailing dot is just a dot', () => {
    expect(names('music.')).toEqual(names('music'));
    const parsed = parseQuery('..music..');
    expect(parsed.kind === 'path' && parsed.segments).toEqual(['music']);
  });
});

describe('patterns', () => {
  it('compiles a segment carrying regex syntax', () => {
    expect(names('^a.*t$')).toEqual(['artist']);
    expect(names('log|metrics').sort()).toEqual(['audit_log', 'daily_metrics']);
  });

  it('matches a pattern against the full path as well as the name', () => {
    expect(names('^sample\\.ops').sort()).toEqual(['audit_log', 'daily_metrics']);
  });

  /*
   * The two readings are alternatives, and the query says which by what is in
   * it. A dot alone is a separator; a dot with an anchor or a quantifier beside
   * it is a wildcard, because no path query looks like that.
   */
  it('is a path when there is no pattern syntax, and a pattern when there is', () => {
    expect(parseQuery('music.album').kind).toBe('path');
    expect(parseQuery('^a.*t$').kind).toBe('pattern');
  });

  it('treats a half-typed pattern as text rather than throwing results away', () => {
    // `album(` on the way to `album(x)` must not clear the list.
    expect(() => names('album(')).not.toThrow();
    expect(names('album(')).toEqual([]);
  });

  it('reads a bare dot as a separator, not a wildcard', () => {
    expect(names('a.b')).toEqual([]);
  });
});

describe('scoring one entity', () => {
  it('weighs the table name above the levels qualifying it', () => {
    const onName = scoreEntity({ name: 'album', schema: 'music' }, parseQuery('album'));
    const onSchema = scoreEntity({ name: 'album', schema: 'music' }, parseQuery('music.album'));
    expect(onName).not.toBeNull();
    expect(onSchema!).toBeGreaterThan(onName!);
  });

  it('prefers a pattern that hit the name over one that only hit the path', () => {
    const onName = scoreEntity({ name: 'artist', schema: 'music' }, parseQuery('^art'));
    const onPath = scoreEntity({ name: 'album', schema: 'music' }, parseQuery('^music'));
    expect(onName!).toBeGreaterThan(onPath!);
  });

  it('cannot match a level the entity does not have', () => {
    expect(scoreEntity({ name: 'album' }, parseQuery('music.album'))).toBeNull();
  });
});

/*
 * MySQL reports no schema per table — the database is the schema there — and
 * the path used to bind against three fixed slots, so every entity from that
 * engine carried a hole in the middle. `production.orders` bound its two words
 * to [schema, name], hit the hole and matched nothing, while `orders` alone
 * worked. From the outside that is a search that does not work.
 */
describe('an engine that reports no schema', () => {
  const flat = [
    { name: 'orders', database: 'production' },
    { name: 'order_items', database: 'production' },
  ];

  it('binds a path against the levels the entity has', () => {
    expect(searchEntities(flat, 'production.orders').map((e) => e.name)).toEqual([
      'orders',
      'order_items',
    ]);
  });

  it('still rules out a level that is not there', () => {
    expect(searchEntities(flat, 'production.public.orders')).toEqual([]);
    expect(searchEntities(flat, 'staging.orders')).toEqual([]);
  });

  it('writes the path without a gap', () => {
    expect(qualifiedPath(flat[0]!)).toBe('production.orders');
  });

  it('does not say the database twice when it is also the schema', () => {
    const mysql = { name: 'orders', database: 'production', schema: 'production' };
    expect(qualifiedPath(mysql)).toBe('production.orders');
    expect(scoreEntity(mysql, parseQuery('production.orders'))).not.toBeNull();
  });
});
