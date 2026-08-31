/**
 * How long something took, in the unit that suits how long it was.
 *
 * `df -h`'s rule, applied to time: pick the unit so the number is one the
 * reader takes in at a glance, and carry about three significant digits.
 * "180000 ms" and "0 ms" are both technically the answer and neither is
 * readable — the first makes the reader divide, and the second says a query
 * that took four tenths of a millisecond took no time at all.
 *
 * The boundaries are where the digits run out rather than where the units
 * change, which is why a millisecond value keeps two decimals below 1 and one
 * decimal below 1000: sub-millisecond is ordinary on SQLite, and rounding it
 * away is the difference between "fast" and "did not run".
 *
 * The symbols are not translated. They are SI (`ms`, `s`, `h`) or the near
 * universal abbreviation (`min`), and the string is a measurement rather than a
 * sentence — which is the same reason `elapsed.ts` keeps its arithmetic here
 * and its *phrases* at the call sites. There are no phrases in this one.
 *
 * Two other duration formats in this app deliberately do not use this, because
 * they answer different questions:
 *
 *   - `elapsedLabel` is a live stopwatch. It holds hundredths at every length
 *     on purpose: a readout that changes its unit as it grows is three numbers
 *     in the same place, and the digit being watched moves sideways each time.
 *   - `JobList`'s is the wall-clock length of something that may still be
 *     going, where `m:ss` is how a duration of that kind is written.
 *
 * This one is for a measurement that has finished and is read once.
 */
export function formatDuration(ms: number): string {
  const value = Math.max(0, ms);

  if (value < 1) return `${value.toFixed(2)} ms`;
  if (value < 1000) return `${value.toFixed(1)} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(2)} s`;
  if (value < 3_600_000) return `${(value / 60_000).toFixed(1)} min`;
  return `${(value / 3_600_000).toFixed(1)} h`;
}
