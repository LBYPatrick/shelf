import type { StatementSample, StatementStat } from '../drivers/types';

/**
 * Turning cumulative counters into "the last hour".
 *
 * Every engine that keeps per-statement timings keeps them the same way: one
 * running total per statement since the counters were last reset. That answers
 * "what has been expensive ever" and nothing else — the question people
 * actually have is "what has been expensive lately", and no engine answers it.
 *
 * So the app keeps its own history. Each reading is stored, and a window is the
 * difference between the newest reading and the oldest one that is still at
 * least as old as the window asks for. That is exactly what a monitoring system
 * does; the only difference is that the samples are taken while the tab is
 * open rather than by a daemon, which is why a window can be wider than the
 * history and has to say so rather than quietly answering a smaller question.
 *
 * Everything here is pure so it can be tested without a database, which matters
 * more than usual: an off-by-one in a difference produces a plausible number
 * rather than an error.
 */

export type WindowId = 'hour' | 'sixHours' | 'day' | 'week' | 'month' | 'all';

export const WINDOWS: readonly { id: WindowId; ms: number }[] = [
  { id: 'hour', ms: 3_600_000 },
  { id: 'sixHours', ms: 6 * 3_600_000 },
  { id: 'day', ms: 24 * 3_600_000 },
  { id: 'week', ms: 7 * 24 * 3_600_000 },
  { id: 'month', ms: 30 * 24 * 3_600_000 },
  // Not a duration: the counters themselves, however far back they go.
  { id: 'all', ms: Number.POSITIVE_INFINITY },
];

export const windowLength = (id: WindowId): number =>
  WINDOWS.find((entry) => entry.id === id)?.ms ?? Number.POSITIVE_INFINITY;

/**
 * How much history is kept, and how much of each reading.
 *
 * The samples live in the application database as one value, so both bounds
 * matter. Five hundred statements is what the drivers fetch; a hundred and
 * twenty is comfortably more than any window's worth of *interesting* ones, and
 * the tail past that is statements called twice.
 */
export const SAMPLE_LIMITS = {
  statementsPerSample: 120,
  samples: 64,
  /* Beyond the widest window a sample can no longer be the baseline for
     anything, so keeping it is keeping a row nothing can read. */
  maxAgeMs: 31 * 24 * 3_600_000,
} as const;

/** A statement's share of one window, as a difference between two readings. */
export interface StatementDelta {
  readonly id: string;
  readonly text: string;
  /** Calls made inside the window. */
  readonly calls: number;
  /** Time spent inside the window, in milliseconds. */
  readonly totalMs: number;
  readonly meanMs: number;
  readonly rows: number;
  /** Slowest single call, which is a property of the counters, not the window. */
  readonly maxMs?: number;
  readonly cacheHitRatio?: number;
  /** Share of the window's total time, 0 to 1. */
  readonly share: number;
  /** No earlier reading had this statement, so it is new since the baseline. */
  readonly firstSeen: boolean;
}

export interface WindowResult {
  readonly statements: readonly StatementDelta[];
  /** When the baseline reading was taken; absent when there was none. */
  readonly from?: number;
  readonly to: number;
  /**
   * Why the answer is not exactly the window that was asked for.
   *
   * `short` means the history does not reach back far enough and the widest
   * available difference was used; `cumulative` means there was only one
   * reading, so the numbers are the counters themselves rather than a
   * difference; `reset` means the server cleared its counters inside the
   * window, which makes every earlier reading useless as a baseline.
   */
  readonly caveat?: 'short' | 'cumulative' | 'reset';
}

/** Trims a reading down to what is worth keeping. */
export function condense(sample: StatementSample): StatementSample {
  const statements = [...sample.statements]
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, SAMPLE_LIMITS.statementsPerSample);
  return { ...sample, statements };
}

/**
 * Adds a reading to the history, oldest first, dropping what is past its use.
 *
 * A reading whose counters have *gone backwards* means the server reset them,
 * and everything before it is a baseline that would produce negative deltas.
 * Rather than filter that out at every read, the history is truncated at the
 * reset — which is the same thing said once.
 */
export function retain(
  history: readonly StatementSample[],
  sample: StatementSample
): readonly StatementSample[] {
  const previous = history[history.length - 1];
  const restarted =
    previous !== undefined &&
    (wasReset(previous, sample) || totalOf(sample) + 1e-6 < totalOf(previous));

  const kept = restarted ? [] : history;
  const cutoff = sample.takenAt - SAMPLE_LIMITS.maxAgeMs;

  return [...kept.filter((entry) => entry.takenAt >= cutoff), condense(sample)].slice(
    -SAMPLE_LIMITS.samples
  );
}

function totalOf(sample: StatementSample): number {
  return sample.statements.reduce((sum, statement) => sum + statement.totalMs, 0);
}

function wasReset(before: StatementSample, after: StatementSample): boolean {
  if (before.resetAt === undefined || after.resetAt === undefined) return false;
  return after.resetAt > before.resetAt;
}

/**
 * The baseline for a window: the newest reading that is at least as old as the
 * window asks for, or the oldest there is.
 *
 * Newest-old-enough rather than oldest-available, because the window should be
 * the length it says wherever the history allows it. Taking the oldest would
 * make every window widen to the whole history and the six selectors would all
 * show the same numbers.
 */
function baselineFor(
  history: readonly StatementSample[],
  latest: StatementSample,
  length: number
): StatementSample | undefined {
  if (!Number.isFinite(length)) return undefined;

  const target = latest.takenAt - length;
  let chosen: StatementSample | undefined;

  for (const sample of history) {
    if (sample === latest) break;
    if (sample.takenAt <= target) chosen = sample;
  }

  // Nothing reaches back that far, so the widest difference available is the
  // honest answer — reported as `short` rather than passed off as the window.
  return chosen ?? history.find((sample) => sample !== latest);
}

/**
 * What each statement cost inside a window.
 *
 * Statements missing from the baseline count in full: they were first seen
 * inside the window, so all of their time was spent inside it. Statements
 * missing from the latest reading have been evicted by the server and simply do
 * not appear, which is the truth about a counter that no longer exists.
 */
export function windowOf(
  history: readonly StatementSample[],
  window: WindowId
): WindowResult | null {
  const latest = history[history.length - 1];
  if (!latest) return null;

  const length = windowLength(window);
  const baseline = baselineFor(history, latest, length);

  const previous = new Map<string, StatementStat>(
    (baseline?.statements ?? []).map((statement) => [statement.id, statement])
  );

  const deltas: Omit<StatementDelta, 'share'>[] = [];

  for (const statement of latest.statements) {
    const before = previous.get(statement.id);
    const calls = statement.calls - (before?.calls ?? 0);
    const totalMs = statement.totalMs - (before?.totalMs ?? 0);

    // A counter that went backwards for one statement means the server dropped
    // and re-created the entry, so the current total is all there is to report.
    const forward = calls >= 0 && totalMs >= 0;

    const finalCalls = forward ? calls : statement.calls;
    const finalTotal = forward ? totalMs : statement.totalMs;
    if (finalCalls <= 0 && finalTotal <= 0) continue;

    deltas.push({
      id: statement.id,
      text: statement.text,
      calls: finalCalls,
      totalMs: finalTotal,
      meanMs: finalCalls > 0 ? finalTotal / finalCalls : 0,
      rows: Math.max(0, (statement.rows ?? 0) - (before?.rows ?? 0)),
      ...(statement.maxMs !== undefined ? { maxMs: statement.maxMs } : {}),
      ...(statement.cacheHitRatio !== undefined
        ? { cacheHitRatio: statement.cacheHitRatio }
        : {}),
      firstSeen: before === undefined && baseline !== undefined,
    });
  }

  const total = deltas.reduce((sum, delta) => sum + delta.totalMs, 0);
  const statements = deltas
    .map((delta) => ({ ...delta, share: total > 0 ? delta.totalMs / total : 0 }))
    .sort((a, b) => b.totalMs - a.totalMs);

  const caveat = ((): WindowResult['caveat'] => {
    if (!baseline) return window === 'all' ? undefined : 'cumulative';
    if (baseline.resetAt !== undefined && wasReset(baseline, latest)) return 'reset';
    if (Number.isFinite(length) && latest.takenAt - baseline.takenAt < length * 0.9) {
      return 'short';
    }
    return undefined;
  })();

  return {
    statements,
    ...(baseline ? { from: baseline.takenAt } : {}),
    to: latest.takenAt,
    ...(caveat ? { caveat } : {}),
  };
}
