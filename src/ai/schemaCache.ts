import { classifyScript } from '@shared/sqlSafety';

/**
 * Remembering what a database's shape is, between turns.
 *
 * Reading a schema is N+1 by nature — `listEntities`, then a round trip per
 * entity for its columns and two more for its indexes and relations — and it
 * ran in full on every turn of every conversation. At the caps in `schema.ts`
 * that is up to two hundred and forty-one queries before a word reaches the
 * model, paid again for each message; the interface said "Reading the schema…"
 * every time because it was.
 *
 * The halves come apart cleanly. The reads depend on the connection alone,
 * which makes them worth keeping. The document assembled out of them depends on
 * the scope and the token budget, and `buildSchemaDocument` and
 * `narrowSchemaDocument` are pure — so that half still runs per turn, and a
 * question about one table still gets a document about that table. Only the
 * database stops being asked twice.
 */

/**
 * How long a read stands.
 *
 * Bounded rather than kept for the life of the connection, because the shape
 * can change without this process seeing it happen: a migration run from a
 * terminal, or somebody else's `ALTER`. Statements this app runs drop the cache
 * directly — see `changesShape` — and this is the backstop for the ones it
 * never sees. Turns in a conversation are seconds apart, so a few minutes makes
 * essentially all of them free while keeping the window a reader is wrong in
 * short enough to be a refresh rather than a bug report.
 */
const TTL_MS = 5 * 60 * 1000;

interface Entry {
  readonly at: number;
  readonly value: Promise<unknown>;
}

/** One connection's reads. Sessions own these; nothing else should. */
export class SchemaCache {
  private readonly entries = new Map<string, Entry>();

  /** The clock is an argument so a test can age an entry without waiting. */
  constructor(private readonly now: () => number = Date.now) {}

  /**
   * The value behind `key`, read if it is missing or stale.
   *
   * The *promise* is stored rather than what it settles to, so two turns asking
   * for the same table at the same moment share one round trip instead of
   * racing to fill the same slot — which is the common case, because a turn
   * fans out across entities eight at a time.
   *
   * A read that rejects is dropped rather than kept. Caching a failure for five
   * minutes turns one bad moment into five bad ones, and the callers here
   * already treat a failed read as "no columns" for the turn they are in.
   */
  async take<T>(key: string, read: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing && this.now() - existing.at < TTL_MS) {
      return (await existing.value) as T;
    }

    const value = read();
    this.entries.set(key, { at: this.now(), value });

    try {
      return await value;
    } catch (error) {
      // Only if this slot is still the one that was written: a `forget()` while
      // the read was in flight means the shape changed under it, and deleting
      // now would throw away whatever replaced it.
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
      throw error;
    }
  }

  /** Everything read from this connection is a guess from here on. */
  forget(): void {
    this.entries.clear();
  }

  /** How many reads are being remembered. For tests, and for nothing else. */
  get size(): number {
    return this.entries.size;
  }
}

/**
 * Whether running this text could have changed the shape of the database.
 *
 * The split on semicolons is wrong for a semicolon inside a string literal, and
 * it does not matter: the only two answers here are "drop a cache" and "do
 * not". A needless drop costs one re-read, and a missed one costs a model that
 * is confidently describing a column that no longer exists — so the split is
 * allowed to be generous, and an `unknown` statement counts as a change for the
 * same reason `sqlSafety` treats one as a write.
 */
export function changesShape(sql: string): boolean {
  const statements = sql.split(';').filter((part) => part.trim() !== '');
  if (statements.length === 0) return false;

  const effect = classifyScript(statements);
  return effect === 'schema' || effect === 'unknown';
}
