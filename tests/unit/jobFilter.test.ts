import { describe, expect, it } from 'vitest';
import {
  NO_FILTER,
  jobDuration,
  matchesJob,
  narrowedBy,
  tracksTheClock,
  type FilterableJob,
  type JobFilter,
} from '@shared/jobFilter';

/** Midday, so "today" has a morning behind it and an afternoon in front. */
const NOW = new Date('2026-08-23T12:00:00').getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function job(over: Partial<FilterableJob> = {}): FilterableJob {
  return {
    name: 'production-20260823-090405',
    status: 'done',
    startedAt: NOW - 5 * MINUTE,
    finishedAt: NOW - 5 * MINUTE + 2000,
    ...over,
  };
}

function filter(over: Partial<JobFilter> = {}): JobFilter {
  return { ...NO_FILTER, ...over };
}

describe('an unfiltered list', () => {
  it('admits everything', () => {
    expect(matchesJob(job(), NO_FILTER, NOW)).toBe(true);
    expect(matchesJob(job({ status: 'failed', finishedAt: undefined }), NO_FILTER, NOW)).toBe(
      true
    );
  });

  it('is not narrowed by anything, and does not track the clock', () => {
    expect(narrowedBy(NO_FILTER)).toBe(0);
    expect(tracksTheClock(NO_FILTER)).toBe(false);
  });
});

describe('searching by name', () => {
  it('matches anywhere in it, ignoring case and surrounding space', () => {
    expect(matchesJob(job({ name: 'June refunds' }), filter({ text: 'refund' }), NOW)).toBe(
      true
    );
    expect(matchesJob(job({ name: 'June refunds' }), filter({ text: '  REFUND ' }), NOW)).toBe(
      true
    );
    expect(matchesJob(job({ name: 'June refunds' }), filter({ text: 'invoice' }), NOW)).toBe(
      false
    );
  });

  it('is not counted as one of the folded-away choices', () => {
    expect(narrowedBy(filter({ text: 'refund' }))).toBe(0);
  });
});

describe('filtering by status', () => {
  it('takes one state at a time', () => {
    expect(matchesJob(job({ status: 'failed' }), filter({ status: 'failed' }), NOW)).toBe(true);
    expect(matchesJob(job({ status: 'done' }), filter({ status: 'failed' }), NOW)).toBe(false);
  });

  it('treats pending and running as one answer', () => {
    for (const status of ['pending', 'running'] as const) {
      expect(
        matchesJob(job({ status, finishedAt: undefined }), filter({ status: 'active' }), NOW)
      ).toBe(true);
    }
    expect(matchesJob(job({ status: 'done' }), filter({ status: 'active' }), NOW)).toBe(false);
  });
});

describe('filtering by when it started', () => {
  it('holds the hour open to exactly an hour', () => {
    const within = filter({ started: 'hour' });
    expect(matchesJob(job({ startedAt: NOW - HOUR + 1 }), within, NOW)).toBe(true);
    expect(matchesJob(job({ startedAt: NOW - HOUR - 1 }), within, NOW)).toBe(false);
  });

  it('means midnight by "today", not twenty-four hours ago', () => {
    const today = filter({ started: 'today' });
    // Half past nine this morning is today; half past nine last night is not,
    // and both are inside the last twenty-four hours.
    expect(matchesJob(job({ startedAt: NOW - 3 * HOUR }), today, NOW)).toBe(true);
    expect(matchesJob(job({ startedAt: NOW - 15 * HOUR }), today, NOW)).toBe(false);
  });

  it('counts a week as the seven days behind now', () => {
    const week = filter({ started: 'week' });
    expect(matchesJob(job({ startedAt: NOW - 6 * 24 * HOUR }), week, NOW)).toBe(true);
    expect(matchesJob(job({ startedAt: NOW - 8 * 24 * HOUR }), week, NOW)).toBe(false);
  });
});

describe('filtering by when it finished', () => {
  it('excludes anything that has not', () => {
    const running = job({ status: 'running', finishedAt: undefined });
    expect(matchesJob(running, filter({ finished: 'today' }), NOW)).toBe(false);
    expect(matchesJob(running, filter({ finished: 'any' }), NOW)).toBe(true);
  });

  it('reads the finish, not the start', () => {
    // Started before the window and finished inside it: a long job answers
    // "finished in the last hour" with yes.
    const long = job({ startedAt: NOW - 5 * HOUR, finishedAt: NOW - MINUTE });
    expect(matchesJob(long, filter({ finished: 'hour' }), NOW)).toBe(true);
    expect(matchesJob(long, filter({ started: 'hour' }), NOW)).toBe(false);
  });
});

describe('filtering by how long it took', () => {
  const took = (ms: number) => job({ startedAt: NOW - ms, finishedAt: NOW });

  it('puts every length in exactly one band', () => {
    const bands = ['instant', 'seconds', 'minute', 'long'] as const;
    for (const ms of [0, 999, 1000, 9_999, 10_000, 59_999, 60_000, 10 * MINUTE]) {
      const hits = bands.filter((band) => matchesJob(took(ms), filter({ took: band }), NOW));
      expect(hits, `${ms}ms landed in ${hits.length} bands`).toHaveLength(1);
    }
  });

  it('names the bands at the boundaries they claim', () => {
    expect(matchesJob(took(999), filter({ took: 'instant' }), NOW)).toBe(true);
    expect(matchesJob(took(1000), filter({ took: 'seconds' }), NOW)).toBe(true);
    expect(matchesJob(took(10_000), filter({ took: 'minute' }), NOW)).toBe(true);
    expect(matchesJob(took(60_000), filter({ took: 'long' }), NOW)).toBe(true);
  });

  it('measures a running job against how long it has taken so far', () => {
    const running = job({
      status: 'running',
      startedAt: NOW - 3 * MINUTE,
      finishedAt: undefined,
    });
    expect(jobDuration(running, NOW)).toBe(3 * MINUTE);
    expect(matchesJob(running, filter({ took: 'long' }), NOW)).toBe(true);
  });

  it('never reports a negative length, whatever the clocks say', () => {
    expect(jobDuration(job({ startedAt: NOW + 5000, finishedAt: undefined }), NOW)).toBe(0);
  });
});

describe('the dimensions together', () => {
  it('narrow rather than widen', () => {
    const failedToday = filter({ status: 'failed', started: 'today' });
    expect(matchesJob(job({ status: 'failed' }), failedToday, NOW)).toBe(true);
    expect(matchesJob(job({ status: 'done' }), failedToday, NOW)).toBe(false);
    expect(
      matchesJob(job({ status: 'failed', startedAt: NOW - 30 * HOUR }), failedToday, NOW)
    ).toBe(false);
  });

  it('are counted for the badge, and say when the list moves on its own', () => {
    expect(narrowedBy(filter({ status: 'failed', took: 'long' }))).toBe(2);
    expect(
      narrowedBy(filter({ status: 'failed', started: 'week', finished: 'hour', took: 'long' }))
    ).toBe(4);
    expect(tracksTheClock(filter({ status: 'failed' }))).toBe(false);
    expect(tracksTheClock(filter({ took: 'long' }))).toBe(true);
  });
});
