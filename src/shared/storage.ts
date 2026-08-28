/**
 * What this app keeps on the machine, as one declaration.
 *
 * Everything Shelf stores lives in one directory the app owns: `shelf.db` for
 * the rows, `jobs/` for the spooled results of dispatched queries. Secrets are
 * the one exception and always will be — they are in the OS keyring, which is
 * the whole point of putting them there — so the only thing this list says
 * about them is which categories take them along when they go.
 *
 * The categories are declared here rather than spelled out in the sheet that
 * draws them and again in the handler that clears them. Two lists would drift,
 * and the way they would drift is a checkbox that reports a size and deletes
 * nothing — the worst possible outcome for a control whose entire job is to be
 * believed.
 */

export type StorageCategoryId =
  'history' | 'chats' | 'jobs' | 'workspace' | 'stats' | 'saved' | 'providers' | 'connections';

export interface StorageCategory {
  /** Also the i18n key for this row's name and note, under `storage.`. */
  readonly id: StorageCategoryId;
  /**
   * Whether it is ticked when the sheet opens.
   *
   * The accumulated stuff is; the things somebody made by hand are not. A sheet
   * that opens with "delete my saved queries and every connection I have set
   * up" already ticked is a sheet that gets used once.
   */
  readonly byDefault: boolean;
  /**
   * Whether clearing this also empties keyring entries.
   *
   * Said in the sheet, because a password removed from the OS keychain is the
   * one thing here that reaches outside the app's own directory.
   */
  readonly takesSecrets?: boolean;
}

export const STORAGE_CATEGORIES: readonly StorageCategory[] = [
  { id: 'history', byDefault: true },
  { id: 'chats', byDefault: true },
  { id: 'jobs', byDefault: true },
  { id: 'workspace', byDefault: true },
  { id: 'stats', byDefault: true },
  { id: 'saved', byDefault: false },
  { id: 'providers', byDefault: false, takesSecrets: true },
  { id: 'connections', byDefault: false, takesSecrets: true },
];

/** What one category is holding right now. */
export interface StorageCategoryUsage {
  readonly id: StorageCategoryId;
  /** Rows, files — whatever the unit of this category is. */
  readonly items: number;
  /**
   * Bytes on disk, as well as they can be known.
   *
   * Exact for the job spools, which are files. Estimated for the rows, from the
   * length of what is in them: SQLite's own page accounting cannot be split by
   * table without `dbstat`, which is a compile-time option this build does not
   * carry. An estimate is honest here in a way it would not be elsewhere —
   * nobody clears a history to reclaim four kilobytes, and the number is there
   * to say "this is the big one", which an estimate does perfectly well.
   */
  readonly bytes: number;
}

export interface StorageUsage {
  /** The directory the app owns. Shown, so "where is it" has an answer. */
  readonly directory: string;
  readonly categories: readonly StorageCategoryUsage[];
}

/**
 * The subdirectory of the app's own directory that holds spooled results.
 *
 * Named here rather than joined here, because this file is imported by the
 * renderer and `node:path` is not. Two processes need the path — main to
 * measure and empty it, the host to write it — and neither can ask the other,
 * so they join the same name onto the same root. A directory the app writes to
 * under a name only one of them knows is a directory it cannot account for,
 * which is the state this file exists to end.
 */
export const JOBS_SUBDIR = 'jobs';

/** Bytes, at the precision a person reads rather than the one a disk uses. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  // One decimal below ten, none above: "1.4 MB" is worth reading and
  // "148.3 MB" is three characters of noise.
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
