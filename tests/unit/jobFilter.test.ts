import { describe, expect, it } from 'vitest';
import {
  addCriterion,
  jobDuration,
  matchesJob,
  narrowedBy,
  NO_FILTER,
  removeCriterion,
  toggleCriterion,
  tracksTheClock,
  type FilterableJob,
  type JobFilter,
} from '@shared/jobFilter';

/*
 * A filter over a log, and the reason it is tested rather than eyeballed: every
 * mistake it can make produces a *shorter list*, not an error. A job that drops
 * out of "last hour" four seconds early looks exactly like a job that was never
 * there.
 *
 * The clock is a parameter throughout, so these can ask about a Tuesday.
 */

const NOON = new Date('2026-03-10T12:00:00').getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const job = (over: Partial<FilterableJob> = {}): FilterableJob => ({
  name: 'production-20260310-090405',
  status: 'done',
  startedAt: NOON - MINUTE,
  finishedAt: NOON - MINUTE + 2_000,
  ...over,
});

const filterOf = (...criteria: [kind: string, value: string][]): JobFilter =>
  criteria.reduce<JobFilter>(
    (filter, [kind, value]) => addCriterion(filter, kind as never, value),
    { ...NO_FILTER, criteria: [] }
  );

describe('an empty filter', () => {
  it('admits everything', () => {
    expect(matchesJob(job(), NO_FILTER, NOON)).toBe(true);
    expect(narrowedBy(NO_FILTER)).toBe(0);
    expect(tracksTheClock(NO_FILTER)).toBe(false);
  });
});

describe('the name', () => {
  const named = (text: string): JobFilter => ({ ...NO_FILTER, text, criteria: [] });

  it('matches anywhere in it, ignoring case', () => {
    expect(matchesJob(job(), named('PRODUCTION'), NOON)).toBe(true);
    expect(matchesJob(job(), named('0310'), NOON)).toBe(true);
    expect(matchesJob(job(), named('staging'), NOON)).toBe(false);
  });

  it('ignores surrounding space, so a stray one does not empty the list', () => {
    expect(matchesJob(job(), named('  production  '), NOON)).toBe(true);
  });

  it('is not counted by the badge — it is visible in its own field', () => {
    expect(narrowedBy(named('anything'))).toBe(0);
  });
});

describe('status', () => {
  it('matches the state exactly', () => {
    expect(matchesJob(job({ status: 'done' }), filterOf(['status', 'done']), NOON)).toBe(true);
    expect(matchesJob(job({ status: 'failed' }), filterOf(['status', 'done']), NOON)).toBe(
      false
    );
  });

  it('treats running and pending as one answer', () => {
    // Both mean "not finished yet", which is the question being asked.
    const active = filterOf(['status', 'active']);
    expect(matchesJob(job({ status: 'running' }), active, NOON)).toBe(true);
    expect(matchesJob(job({ status: 'pending' }), active, NOON)).toBe(true);
    expect(matchesJob(job({ status: 'done' }), active, NOON)).toBe(false);
  });
});

describe('when it started', () => {
  it('admits the last hour by the hour, not by the clock face', () => {
    const lastHour = filterOf(['started', 'hour']);
    expect(matchesJob(job({ startedAt: NOON - 59 * MINUTE }), lastHour, NOON)).toBe(true);
    expect(matchesJob(job({ startedAt: NOON - 61 * MINUTE }), lastHour, NOON)).toBe(false);
  });

  it('means midnight by "today", not twenty-four hours ago', () => {
    const today = filterOf(['started', 'today']);
    const nineThisMorning = new Date('2026-03-10T09:00:00').getTime();
    const nineYesterday = new Date('2026-03-09T09:00:00').getTime();

    expect(matchesJob(job({ startedAt: nineThisMorning }), today, NOON)).toBe(true);
    // The distinction the word actually carries.
    expect(matchesJob(job({ startedAt: nineYesterday }), today, NOON)).toBe(false);
  });

  it('admits a week', () => {
    const week = filterOf(['started', 'week']);
    expect(matchesJob(job({ startedAt: NOON - 6 * 24 * HOUR }), week, NOON)).toBe(true);
    expect(matchesJob(job({ startedAt: NOON - 8 * 24 * HOUR }), week, NOON)).toBe(false);
  });
});

describe('when it finished', () => {
  it('excludes anything that has not', () => {
    // Asking when something finished is asking about finished things.
    const running = job({ status: 'running', finishedAt: undefined });
    expect(matchesJob(running, filterOf(['finished', 'hour']), NOON)).toBe(false);
  });

  it('measures from the finish, not the start', () => {
    const longRun = job({ startedAt: NOON - 3 * HOUR, finishedAt: NOON - 10 * MINUTE });
    expect(matchesJob(longRun, filterOf(['finished', 'hour']), NOON)).toBe(true);
    expect(matchesJob(longRun, filterOf(['started', 'hour']), NOON)).toBe(false);
  });
});

describe('how long it took', () => {
  const took = (ms: number) => job({ startedAt: NOON - ms, finishedAt: NOON });

  it('puts every job in exactly one band', () => {
    // Bands partition, so picking a second is a different set rather than a
    // subset of the first.
    const bands = ['instant', 'seconds', 'minute', 'long'];
    for (const ms of [500, 5_000, 30_000, 120_000]) {
      const hits = bands.filter((band) => matchesJob(took(ms), filterOf(['took', band]), NOON));
      expect(hits, `${ms}ms landed in ${hits.join(', ')}`).toHaveLength(1);
    }
  });

  it('measures a job that is still going from now', () => {
    // Otherwise the job somebody filtering by length is looking for — the one
    // that has been running for ten minutes — is the one that cannot be found.
    const running = job({
      status: 'running',
      startedAt: NOON - 5 * MINUTE,
      finishedAt: undefined,
    });
    expect(jobDuration(running, NOON)).toBe(5 * MINUTE);
    expect(matchesJob(running, filterOf(['took', 'long']), NOON)).toBe(true);
  });
});

describe('several criteria at once', () => {
  it('requires every one of them', () => {
    const both = filterOf(['status', 'done'], ['took', 'seconds']);
    expect(matchesJob(job(), both, NOON)).toBe(true);
    expect(matchesJob(job({ status: 'failed' }), both, NOON)).toBe(false);
  });

  it('lets two of a kind contradict rather than silently replacing one', () => {
    // Both chips are on screen and either can be switched off, which is what
    // the switch is for. Choosing for the reader would be worse.
    const contradiction = filterOf(['status', 'done'], ['status', 'failed']);
    expect(matchesJob(job({ status: 'done' }), contradiction, NOON)).toBe(false);
    expect(matchesJob(job({ status: 'failed' }), contradiction, NOON)).toBe(false);
  });
});

describe('switching a criterion off', () => {
  it('stops applying it without forgetting it', () => {
    const filter = filterOf(['status', 'failed']);
    expect(matchesJob(job({ status: 'done' }), filter, NOON)).toBe(false);

    const off = toggleCriterion(filter, 0);
    expect(matchesJob(job({ status: 'done' }), off, NOON)).toBe(true);
    // Still there, still remembering what it was.
    expect(off.criteria[0]).toMatchObject({ kind: 'status', value: 'failed', enabled: false });
  });

  it('goes back on with the same value', () => {
    const filter = toggleCriterion(toggleCriterion(filterOf(['took', 'long']), 0), 0);
    expect(filter.criteria[0]).toMatchObject({ value: 'long', enabled: true });
  });

  it('is not counted while it is off', () => {
    const filter = filterOf(['status', 'done'], ['took', 'long']);
    expect(narrowedBy(filter)).toBe(2);
    expect(narrowedBy(toggleCriterion(filter, 0))).toBe(1);
  });

  it('stops the list tracking the clock', () => {
    const filter = filterOf(['started', 'hour']);
    expect(tracksTheClock(filter)).toBe(true);
    expect(tracksTheClock(toggleCriterion(filter, 0))).toBe(false);
  });
});

describe('adding and removing', () => {
  it('keeps them in the order they were thought of', () => {
    const filter = filterOf(['took', 'long'], ['status', 'done'], ['started', 'hour']);
    expect(filter.criteria.map((criterion) => criterion.kind)).toEqual([
      'took',
      'status',
      'started',
    ]);
  });

  it('removes the one named and leaves the rest alone', () => {
    const filter = filterOf(['status', 'done'], ['took', 'long'], ['started', 'hour']);
    const fewer = removeCriterion(filter, 1);
    expect(fewer.criteria.map((criterion) => criterion.kind)).toEqual(['status', 'started']);
  });

  it('never mutates what it was given', () => {
    // The store holds this in a ref; an in-place edit would change it without
    // telling anyone.
    const filter = filterOf(['status', 'done']);
    const before = JSON.stringify(filter);
    addCriterion(filter, 'took', 'long');
    removeCriterion(filter, 0);
    toggleCriterion(filter, 0);
    expect(JSON.stringify(filter)).toBe(before);
  });

  it('only status is free of the clock', () => {
    expect(tracksTheClock(filterOf(['status', 'done']))).toBe(false);
    expect(tracksTheClock(filterOf(['took', 'instant']))).toBe(true);
    expect(tracksTheClock(filterOf(['finished', 'today']))).toBe(true);
  });
});
