import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { StorageCategoryId, StorageCategoryUsage, StorageUsage } from '@shared/storage';
import { STORAGE_CATEGORIES } from '@shared/storage';
import type { ConnectionRepository } from './connections';
import type { AppDatabase } from './database';
import type { ProviderRepository } from './providers';

/**
 * What the app is holding, and how to stop holding it.
 *
 * Everything lives in one directory this process owns — `shelf.db` for the rows
 * and `jobs/` for the spooled results of dispatched queries, which is by far
 * the largest thing here and used to be in the system temp directory where the
 * app could neither account for it nor promise it would still be there.
 *
 * Measuring is per category rather than per file, because a size nobody can
 * attribute is a number and not an answer: "148 MB" tells you nothing you can
 * act on, and "148 MB of job results, 40 KB of everything else" tells you which
 * checkbox to tick.
 *
 * Rows are *estimated* from their own lengths. SQLite cannot report bytes per
 * table without the `dbstat` virtual table, which is a compile-time option this
 * build does not carry, and the alternative — reporting the whole file against
 * one category — would be wrong rather than approximate. The estimate is what
 * the rows actually contain, which is the part that grows.
 */

/** How one category is counted and how it is emptied. */
interface Kind {
  /** Rows and their estimated bytes. Absent for a category held as files. */
  readonly measure?: string;
  /** Run in one transaction, in order. Absent where clearing is not SQL. */
  readonly clear?: readonly string[];
}

const KINDS: Readonly<Record<StorageCategoryId, Kind>> = {
  history: {
    measure:
      'SELECT COUNT(*) AS items, COALESCE(SUM(LENGTH(text)), 0) AS bytes FROM query_history',
    clear: ['DELETE FROM query_history'],
  },
  chats: {
    measure:
      'SELECT COUNT(*) AS items, COALESCE(SUM(LENGTH(body) + LENGTH(title)), 0) AS bytes FROM chat',
    clear: ['DELETE FROM chat'],
  },
  /*
   * Spool files, measured below — and the index that points at them.
   *
   * The list of jobs is a `setting` row, not a table, and clearing the files
   * without it leaves a panel full of cards whose rows are gone: every one of
   * them opens onto nothing. They go together or neither goes.
   */
  jobs: {
    clear: ["DELETE FROM setting WHERE key = 'jobs'"],
  },
  /*
   * The open tabs, which are a `setting` row per connection.
   *
   * `tab` and `grid_layout` are in the first migration and nothing writes to
   * them — the session was moved into `setting` and the tables were left
   * behind. They are measured and cleared anyway, because a category that
   * reads only where the data is *today* is a category that quietly stops
   * covering anything the day it moves back.
   */
  workspace: {
    measure: `SELECT (SELECT COUNT(*) FROM setting WHERE key LIKE 'session:%')
                   + (SELECT COUNT(*) FROM tab)
                   + (SELECT COUNT(*) FROM grid_layout) AS items,
                     (SELECT COALESCE(SUM(LENGTH(value)), 0) FROM setting WHERE key LIKE 'session:%')
                   + (SELECT COALESCE(SUM(LENGTH(state) + LENGTH(title)), 0) FROM tab)
                   + (SELECT COALESCE(SUM(LENGTH(layout)), 0) FROM grid_layout) AS bytes`,
    clear: [
      "DELETE FROM setting WHERE key LIKE 'session:%'",
      'DELETE FROM tab',
      'DELETE FROM grid_layout',
    ],
  },
  /*
   * The server's own counters, as this app has sampled them over time.
   *
   * A row per connection, and it only grows — which is the whole reason the
   * statistics view can answer "the last hour" about a database that keeps no
   * such history. Clearing it is not free: the next reading becomes a baseline
   * again and the first window after it is empty.
   */
  stats: {
    measure: `SELECT COUNT(*) AS items, COALESCE(SUM(LENGTH(value)), 0) AS bytes
                FROM setting WHERE key LIKE 'stats:%'`,
    clear: ["DELETE FROM setting WHERE key LIKE 'stats:%'"],
  },
  saved: {
    measure: `SELECT (SELECT COUNT(*) FROM saved_query) AS items,
                     (SELECT COALESCE(SUM(LENGTH(text) + LENGTH(name)), 0) FROM saved_query)
                   + (SELECT COALESCE(SUM(LENGTH(text)), 0) FROM saved_query_version) AS bytes`,
    // The versions and the folders go with them: a version of a query that no
    // longer exists is a row nothing can ever reach.
    clear: [
      'DELETE FROM saved_query_version',
      'DELETE FROM saved_query',
      'DELETE FROM saved_query_folder',
    ],
  },
  providers: {
    measure:
      'SELECT COUNT(*) AS items, COALESCE(SUM(LENGTH(name) + LENGTH(model)), 0) AS bytes FROM ai_provider',
    // Cleared through the repository, so the keys go with the rows. The owner
    // id a key is filed under is that file's business, and a copy of the
    // prefix here would be a second place for it to be wrong.
  },
  // Connections go through their repository, so the secrets go with them.
  connections: {
    measure: `SELECT (SELECT COUNT(*) FROM connection) AS items,
                     (SELECT COALESCE(SUM(LENGTH(name) + LENGTH(config)), 0) FROM connection) AS bytes`,
  },
};

interface Measured {
  items: number | null;
  bytes: number | null;
}

export class StorageRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly connections: ConnectionRepository,
    private readonly providers: ProviderRepository,
    /** The app's own directory. Passed rather than read, so a test can aim it. */
    private readonly directory: string,
    /** Where dispatched queries are spooled. Under `directory` in the app. */
    private readonly jobsDirectory: string
  ) {}

  usage(): StorageUsage {
    return {
      directory: this.directory,
      categories: STORAGE_CATEGORIES.map((category) => this.measure(category.id)),
    };
  }

  private measure(id: StorageCategoryId): StorageCategoryUsage {
    if (id === 'jobs') return { id, ...this.spools() };

    const sql = KINDS[id].measure;
    if (!sql) return { id, items: 0, bytes: 0 };

    /*
     * A table that does not exist yet is empty, not an error. Every one of
     * these is created by a migration or by a repository's constructor, and the
     * order those run in is not this file's business.
     */
    try {
      const row = this.db.prepare(sql).get() as Measured | undefined;
      return { id, items: row?.items ?? 0, bytes: row?.bytes ?? 0 };
    } catch {
      return { id, items: 0, bytes: 0 };
    }
  }

  /** The spool files, counted and added up. Exact, because they are files. */
  private spools(): { items: number; bytes: number } {
    let items = 0;
    let bytes = 0;

    try {
      for (const name of readdirSync(this.jobsDirectory)) {
        try {
          const info = statSync(join(this.jobsDirectory, name));
          if (!info.isFile()) continue;
          items += 1;
          bytes += info.size;
        } catch {
          // Swept between the listing and the stat. Not an error: it is gone,
          // which is the state this is measuring the absence of.
        }
      }
    } catch {
      // No directory means no jobs have been dispatched on this machine.
    }

    return { items, bytes };
  }

  /**
   * Empties the categories named, and nothing else.
   *
   * One transaction across all of them: a clear that half-succeeded would leave
   * somebody with a sheet reporting sizes that no longer describe anything, and
   * no way to tell which half went. The files are removed after it commits,
   * because a filesystem cannot join a transaction and doing them first would
   * delete rows' worth of data for a clear that then rolled back.
   */
  clear(ids: readonly StorageCategoryId[]): void {
    const wanted = new Set(ids);

    const statements = STORAGE_CATEGORIES.filter((category) => wanted.has(category.id))
      .flatMap((category) => KINDS[category.id].clear ?? [])
      .map((sql) => this.db.prepare(sql));

    this.db.transaction(() => {
      for (const statement of statements) statement.run();
    })();

    /*
     * The two that hold secrets go through their own repositories, one at a
     * time, because removing one is more than a `DELETE`: the repository clears
     * the keyring entries too, and a row deleted with SQL would leave its
     * password encrypted in the `secret` table under an owner nothing refers to
     * any more.
     */
    if (wanted.has('providers')) {
      for (const provider of this.providers.list()) this.providers.remove(provider.id);
    }

    if (wanted.has('connections')) {
      for (const connection of this.connections.list()) this.connections.remove(connection.id);
      this.db.prepare('DELETE FROM connection_folder').run();
    }

    if (wanted.has('jobs')) this.clearSpools();
  }

  private clearSpools(): void {
    try {
      for (const name of readdirSync(this.jobsDirectory)) {
        rmSync(join(this.jobsDirectory, name), { force: true, recursive: true });
      }
    } catch {
      // Nothing there. Clearing what does not exist is not a failure.
    }
  }
}
