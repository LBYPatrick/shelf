/**
 * A byte count, in the unit a person would say it in.
 *
 * One decimal below ten so "1.4 GB" keeps the information that "1 GB" throws
 * away, and none above it because nobody needs to know a table is 847.3 MB
 * rather than 847.
 */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return '—';

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = Math.max(0, bytes);
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
