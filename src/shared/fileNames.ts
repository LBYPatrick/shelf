/**
 * Naming a file the user has not named.
 *
 * A fixed fallback — `query-results` — is a name that collides with itself.
 * Export twice and the save dialog offers the same name again, so the second
 * export either overwrites the first or has to be renamed by hand, and a folder
 * of them is a folder of `query-results (3)`. A timestamp makes the name unique
 * and, more usefully, sorts a directory of exports into the order they were
 * taken.
 *
 * The clock and the random part are arguments rather than read here, so the
 * result is a pure function of its inputs and can be asserted rather than
 * pattern-matched.
 */

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** Local time, because the reader is looking for "the one I took at half four". */
export function timestamp(at: Date): string {
  return (
    `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  );
}

/** Six digits, so two exports in the same second still differ. */
export function suffix(random: number): string {
  return pad(Math.floor(Math.abs(random) * 1_000_000) % 1_000_000, 6);
}

/**
 * Anything that is not safe in a file name becomes a hyphen, and runs of them
 * collapse — a saved query called "orders / last 30 days" should not produce a
 * path with a directory in it.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
}

/**
 * The name offered in the save dialog, without an extension.
 *
 * A name the user chose is kept as they wrote it, only made safe for a
 * filesystem; anything else is stamped.
 */
export function exportName(
  chosen: string | undefined,
  fallback: string,
  at: Date,
  random: number
): string {
  const clean = slugify(chosen ?? '');
  return clean || `${slugify(fallback) || 'export'}-${timestamp(at)}-${suffix(random)}`;
}

/**
 * The name offered when saving a connection or the settings as a document.
 *
 * Always stamped from the thing's own name rather than offered blank: these are
 * files people accumulate a directory of, and `settings.json` written four
 * times is four files called `settings 2.json`.
 */
export function documentFileName(name: string, fallback: string, extension = 'json'): string {
  return `${slugify(name) || fallback}.${extension}`;
}
