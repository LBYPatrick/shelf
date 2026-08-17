import { describe, expect, it } from 'vitest';
import type { StatementSample } from '@drivers/types';
import { SAMPLE_LIMITS, condense, retain, windowOf } from '@shared/queryStats';

const HOUR = 3_600_000;

/** A reading, written as the running totals each statement had at the time. */
function sample(
  takenAt: number,
  totals: Record<string, [calls: number, totalMs: number]>,
  resetAt?: number
): StatementSample {
  return {
    takenAt,
    ...(resetAt !== undefined ? { resetAt } : {}),
    statements: Object.entries(totals).map(([id, [calls, totalMs]]) => ({
      id,
      text: `SELECT ${id}`,
      calls,
      totalMs,
      meanMs: calls > 0 ? totalMs / calls : 0,
      rows: calls,
    })),
  };
}

const at = (result: ReturnType<typeof windowOf>, id: string) =>
  result?.statements.find((statement) => statement.id === id);

describe('windowing cumulative counters', () => {
  const history = [
    sample(0, { a: [100, 1000], b: [10, 500] }),
    sample(HOUR, { a: [150, 1600], b: [12, 520] }),
    sample(2 * HOUR, { a: [200, 1900], b: [20, 900], c: [5, 700] }),
  ];

  it('reports the difference across the window, not the running total', () => {
    const result = windowOf(history, 'hour');
    expect(at(result, 'a')?.calls).toBe(50);
    expect(at(result, 'a')?.totalMs).toBe(300);
    expect(at(result, 'b')?.totalMs).toBe(380);
  });

  it('counts a statement first seen inside the window in full', () => {
    const result = windowOf(history, 'hour');
    expect(at(result, 'c')?.totalMs).toBe(700);
    expect(at(result, 'c')?.firstSeen).toBe(true);
  });

  /*
   * The reason the baseline is the newest old-enough reading rather than the
   * oldest available: taking the oldest would make every window widen to the
   * whole history, and the six selectors would all show the same numbers.
   */
  it('gives a wider window a wider answer', () => {
    const hour = windowOf(history, 'hour');
    const day = windowOf(history, 'day');
    expect(at(hour, 'a')?.totalMs).toBe(300);
    expect(at(day, 'a')?.totalMs).toBe(900);
  });

  it('sorts by time spent, and shares sum to one', () => {
    const result = windowOf(history, 'day')!;
    const times = result.statements.map((statement) => statement.totalMs);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(result.statements.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 6);
  });

  it('drops statements that did nothing inside the window', () => {
    const flat = [sample(0, { a: [100, 1000] }), sample(HOUR, { a: [100, 1000] })];
    expect(windowOf(flat, 'hour')?.statements).toEqual([]);
  });

  it('has nothing to say about an empty history', () => {
    expect(windowOf([], 'hour')).toBeNull();
  });
});

describe('saying what the answer actually is', () => {
  it('admits when one reading is all there is', () => {
    const result = windowOf([sample(0, { a: [1, 5] })], 'hour');
    expect(result?.caveat).toBe('cumulative');
    // And "all time" is exactly what one cumulative reading is, so no caveat.
    expect(windowOf([sample(0, { a: [1, 5] })], 'all')?.caveat).toBeUndefined();
  });

  it('admits when the history does not reach back far enough', () => {
    const history = [sample(0, { a: [1, 5] }), sample(HOUR, { a: [2, 9] })];
    expect(windowOf(history, 'hour')?.caveat).toBeUndefined();
    expect(windowOf(history, 'week')?.caveat).toBe('short');
  });

  it('reports the span it actually used', () => {
    const history = [sample(0, { a: [1, 5] }), sample(3 * HOUR, { a: [2, 9] })];
    const result = windowOf(history, 'day')!;
    expect(result.from).toBe(0);
    expect(result.to).toBe(3 * HOUR);
  });
});

describe('a server that resets its counters', () => {
  /*
   * The failure this exists to prevent is silent: without it the difference
   * comes out negative, and a negative total sorts to the bottom and reads as a
   * statement that costs nothing.
   */
  it('throws away a history the reset made meaningless', () => {
    const before = [sample(0, { a: [100, 1000] }, 500)];
    const after = retain(before, sample(HOUR, { a: [3, 20] }, 5_000));
    expect(after).toHaveLength(1);
    expect(after[0]!.takenAt).toBe(HOUR);
  });

  it('notices a reset even where the server reports no reset time', () => {
    const before = [sample(0, { a: [100, 1000] })];
    const after = retain(before, sample(HOUR, { a: [3, 20] }));
    expect(after).toHaveLength(1);
  });

  it('keeps the history when the counters only went up', () => {
    const before = [sample(0, { a: [100, 1000] })];
    expect(retain(before, sample(HOUR, { a: [140, 1400] }))).toHaveLength(2);
  });

  it('never reports a negative window', () => {
    // One statement's entry was dropped and re-created, which is a rollback of
    // that counter alone and not of the whole view.
    const history = [
      sample(0, { a: [100, 1000], b: [50, 400] }),
      sample(HOUR, { a: [120, 1200], b: [2, 15] }),
    ];
    for (const statement of windowOf(history, 'hour')!.statements) {
      expect(statement.totalMs).toBeGreaterThanOrEqual(0);
      expect(statement.calls).toBeGreaterThanOrEqual(0);
    }
    expect(at(windowOf(history, 'hour'), 'b')?.totalMs).toBe(15);
  });
});

describe('holding the history to a size', () => {
  it('keeps only the costliest statements of a reading', () => {
    const wide = sample(
      0,
      Object.fromEntries(
        Array.from({ length: 400 }, (_, i) => [`s${i}`, [i + 1, i + 1] as [number, number]])
      )
    );
    const kept = condense(wide);
    expect(kept.statements).toHaveLength(SAMPLE_LIMITS.statementsPerSample);
    expect(kept.statements[0]!.totalMs).toBe(400);
  });

  it('keeps a bounded number of readings', () => {
    let history: readonly StatementSample[] = [];
    for (let i = 0; i < SAMPLE_LIMITS.samples * 2; i += 1) {
      history = retain(history, sample(i * 60_000, { a: [i + 1, (i + 1) * 10] }));
    }
    expect(history).toHaveLength(SAMPLE_LIMITS.samples);
  });

  it('drops readings too old to be a baseline for anything', () => {
    const ancient = sample(0, { a: [1, 1] });
    const now = SAMPLE_LIMITS.maxAgeMs + HOUR;
    expect(retain([ancient], sample(now, { a: [2, 2] }))).toHaveLength(1);
  });
});
