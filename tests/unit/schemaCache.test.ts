import { describe, expect, it } from 'vitest';
import type { Capabilities, DatabaseClient } from '../../src/drivers/types';
import { gatherSchema } from '../../src/ai/schema';
import { changesShape, SchemaCache } from '../../src/ai/schemaCache';

/**
 * The cache in front of an N+1 read.
 *
 * Every one of these is a way the cost came back or the answer went stale: a
 * second turn paying for the database again, two turns racing to fill one slot,
 * a failed read remembered as an empty table, and a migration the app ran
 * itself leaving the model describing a column that is gone.
 */

/** A clock a test can move, since the alternative is waiting five minutes. */
function clock(start = 0) {
  let at = start;
  return {
    now: () => at,
    advance: (ms: number) => {
      at += ms;
    },
  };
}

describe('SchemaCache', () => {
  it('reads once and answers the second ask from memory', async () => {
    const cache = new SchemaCache();
    let reads = 0;

    const read = async () => {
      reads += 1;
      return ['id', 'name'];
    };

    expect(await cache.take('columns:public.album', read)).toEqual(['id', 'name']);
    expect(await cache.take('columns:public.album', read)).toEqual(['id', 'name']);
    expect(reads).toBe(1);
  });

  it('keys are separate, so one table does not answer for another', async () => {
    const cache = new SchemaCache();

    await cache.take('columns:album', async () => ['album_id']);
    const other = await cache.take('columns:artist', async () => ['artist_id']);

    expect(other).toEqual(['artist_id']);
    expect(cache.size).toBe(2);
  });

  it('shares one round trip between callers that arrive together', async () => {
    const cache = new SchemaCache();
    let reads = 0;

    let release: (value: string[]) => void = () => undefined;
    const read = () => {
      reads += 1;
      return new Promise<string[]>((resolve) => {
        release = resolve;
      });
    };

    // A turn fans out across entities eight at a time, so two asks for the same
    // table before either has answered is the ordinary case, not a corner.
    const first = cache.take('columns:album', read);
    const second = cache.take('columns:album', read);
    release(['id']);

    expect(await first).toEqual(['id']);
    expect(await second).toEqual(['id']);
    expect(reads).toBe(1);
  });

  it('re-reads once the entry is older than its time to live', async () => {
    const time = clock();
    const cache = new SchemaCache(time.now);
    let reads = 0;

    const read = async () => {
      reads += 1;
      return reads;
    };

    expect(await cache.take('entities:*', read)).toBe(1);

    time.advance(4 * 60 * 1000);
    expect(await cache.take('entities:*', read)).toBe(1);

    time.advance(2 * 60 * 1000);
    expect(await cache.take('entities:*', read)).toBe(2);
  });

  it('does not remember a failure', async () => {
    const cache = new SchemaCache();
    let reads = 0;

    const read = async () => {
      reads += 1;
      if (reads === 1) throw new Error('connection reset');
      return ['id'];
    };

    await expect(cache.take('columns:album', read)).rejects.toThrow('connection reset');
    expect(cache.size).toBe(0);

    // A read that failed is an empty table for the turn it failed in, and not
    // for the five minutes after it.
    expect(await cache.take('columns:album', read)).toEqual(['id']);
  });

  it('forgets everything when the shape has moved', async () => {
    const cache = new SchemaCache();
    let reads = 0;

    const read = async () => {
      reads += 1;
      return reads;
    };

    await cache.take('columns:album', read);
    cache.forget();
    await cache.take('columns:album', read);

    expect(reads).toBe(2);
  });

  it('keeps a read that landed after the cache was dropped out of the way', async () => {
    const cache = new SchemaCache();

    let fail: (error: Error) => void = () => undefined;
    const slow = cache.take('columns:album', () => {
      return new Promise<string[]>((_resolve, reject) => {
        fail = reject;
      });
    });

    cache.forget();
    await cache.take('columns:album', async () => ['id']);

    fail(new Error('too late'));
    await expect(slow).rejects.toThrow('too late');

    // The failure belonged to an entry that had already been replaced, so
    // cleaning up after it must not take the replacement with it.
    expect(cache.size).toBe(1);
  });
});

describe('changesShape', () => {
  it('is false for reads and for row changes', () => {
    expect(changesShape('SELECT * FROM album')).toBe(false);
    expect(changesShape('UPDATE album SET title = $1 WHERE id = $2')).toBe(false);
    expect(changesShape('INSERT INTO album (title) VALUES ($1)')).toBe(false);
  });

  it('is true for a statement that changes the shape', () => {
    expect(changesShape('ALTER TABLE album ADD COLUMN year int')).toBe(true);
    expect(changesShape('CREATE TABLE t (id int)')).toBe(true);
    expect(changesShape('DROP TABLE album')).toBe(true);
  });

  it('finds the change anywhere in a script, not only at the front', () => {
    // The reason for splitting at all: a script that opens with a SELECT reads
    // as a read, and the ALTER four lines down is the whole point.
    expect(changesShape('SELECT 1;\nALTER TABLE album ADD COLUMN year int;')).toBe(true);
  });

  it('treats a statement it cannot recognise as a change', () => {
    // The same call `sqlSafety` makes: a verb we do not know is assumed to be
    // the more expensive possibility. `VACUUM` is a write and is recognised as
    // one — it moves rows about and leaves the shape alone — so the case here
    // is a verb from an engine nobody has taught this classifier about.
    expect(changesShape('MATERIALIZE ZONEMAP ON album')).toBe(true);
  });

  it('is false for nothing at all', () => {
    expect(changesShape('')).toBe(false);
    expect(changesShape('   ;;  ')).toBe(false);
  });
});

const CAPABILITIES = {
  sql: true,
  queryLanguage: 'sql',
  schemas: false,
  indexes: true,
  relations: true,
  nouns: { database: 'database', entity: 'table', row: 'row', column: 'column' },
} as unknown as Capabilities;

/** Counts the round trips a gather actually made. */
function countingClient(tables: readonly string[]) {
  const trips = { entities: 0, columns: 0, indexes: 0, relations: 0 };

  const client = {
    engine: 'mock',
    capabilities: CAPABILITIES,
    listEntities: async () => {
      trips.entities += 1;
      return tables.map((name) => ({ name, kind: 'table' }));
    },
    listColumns: async () => {
      trips.columns += 1;
      return [{ name: 'id', type: 'int', nullable: false }];
    },
    listIndexes: async () => {
      trips.indexes += 1;
      return [];
    },
    listRelations: async () => {
      trips.relations += 1;
      return [];
    },
  } as unknown as DatabaseClient;

  return { client, trips };
}

/**
 * The claim the cache exists to make.
 *
 * Gathering is N+1 — one call for the list and three per table — and it ran in
 * full on every turn. These assert the number of round trips rather than the
 * document, because the document was always right; what was wrong was how many
 * times the database was asked to produce it.
 */
describe('gathering a schema through a cache', () => {
  const scope = { kind: 'connection' } as const;

  it('reads the database once across turns', async () => {
    const { client, trips } = countingClient(['album', 'artist', 'track']);
    const cache = new SchemaCache();

    const first = await gatherSchema(client, scope, { budget: 24_000, cache });
    expect(trips).toEqual({ entities: 1, columns: 3, indexes: 3, relations: 3 });

    const second = await gatherSchema(client, scope, { budget: 24_000, cache });
    expect(trips).toEqual({ entities: 1, columns: 3, indexes: 3, relations: 3 });

    // Free, and the same answer — a cache that returned less would be worse
    // than no cache at all.
    expect(second).toEqual(first);
  });

  it('reads the database every turn without one', async () => {
    const { client, trips } = countingClient(['album', 'artist', 'track']);

    await gatherSchema(client, scope, { budget: 24_000 });
    await gatherSchema(client, scope, { budget: 24_000 });

    expect(trips).toEqual({ entities: 2, columns: 6, indexes: 6, relations: 6 });
  });

  it('reads again after the shape has changed', async () => {
    const { client, trips } = countingClient(['album']);
    const cache = new SchemaCache();

    await gatherSchema(client, scope, { budget: 24_000, cache });
    cache.forget();
    await gatherSchema(client, scope, { budget: 24_000, cache });

    expect(trips.columns).toBe(2);
  });
});
