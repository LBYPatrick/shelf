/**
 * What a handful of round trips says about a connection.
 *
 * The numbers a person actually wants from a ping are not the mean: a database
 * that answers in 2ms nineteen times and 400ms once is a different thing from
 * one that answers in 22ms every time, and both average about the same. So the
 * summary is order statistics — the median, the tail, and how far apart the
 * two are — which is the shape of the question "is this connection steady".
 *
 * Pure and unit tested. A percentile is four lines and three of them are
 * off-by-one opportunities, and every one of those produces a plausible number
 * rather than an error.
 */

export interface LatencySummary {
  readonly count: number;
  readonly min: number;
  readonly median: number;
  readonly max: number;
  /** max − median. How much worse the worst trip was than a typical one. */
  readonly jitter: number;
}

/*
 * There is no p95 here, and that is deliberate.
 *
 * A diagnosis takes on the order of twenty samples, and the nearest-rank 95th
 * of twenty is the nineteenth — so the single terrible trip that is the whole
 * reason to look at a tail falls just outside it and the number reads clean.
 * Interpolating would invent a value between two trips that did happen. At this
 * sample size the honest tail is the worst trip, so that is what is reported.
 */

/**
 * The nearest-rank percentile, on a copy.
 *
 * Nearest-rank rather than interpolated because these are *observations*: with
 * twenty samples, "the 95th percentile" should be one of the trips that
 * actually happened, not a number halfway between two of them that did.
 */
export function percentile(samples: readonly number[], fraction: number): number {
  if (samples.length === 0) return 0;

  const sorted = [...samples].sort((a, b) => a - b);
  const clamped = Math.min(1, Math.max(0, fraction));
  const rank = Math.ceil(clamped * sorted.length);

  return sorted[Math.max(0, rank - 1)]!;
}

export function summarize(samples: readonly number[]): LatencySummary {
  if (samples.length === 0) {
    return { count: 0, min: 0, median: 0, max: 0, jitter: 0 };
  }

  const median = percentile(samples, 0.5);
  const max = percentile(samples, 1);

  return {
    count: samples.length,
    min: percentile(samples, 0),
    median,
    max,
    // Never negative, though it cannot be: the median is an observation and the
    // maximum is the largest one, so saying so costs nothing and outlives any
    // later change to how the median is taken.
    jitter: Math.max(0, max - median),
  };
}

export type Steadiness = 'steady' | 'variable' | 'erratic';

/**
 * Steady, variable, or erratic.
 *
 * Relative to the median rather than in milliseconds, because 40ms of jitter on
 * a 4ms local socket is a different fact from 40ms on a 300ms link across an
 * ocean — the first is something wrong, the second is the ocean. A floor stops
 * the ratio being meaningless when the median is under a millisecond: a socket
 * answering in 0.2ms and 0.6ms is not "erratic", it is a socket.
 */
const FLOOR_MS = 2;

export function steadiness(summary: LatencySummary): Steadiness {
  if (summary.count === 0) return 'erratic';

  const ratio = summary.jitter / Math.max(FLOOR_MS, summary.median);
  if (ratio <= 0.5) return 'steady';
  if (ratio <= 2) return 'variable';
  return 'erratic';
}
