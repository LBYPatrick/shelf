import { describe, expect, it } from 'vitest';
import { elapsedSince, FOREVER } from '@shared/elapsed';

/*
 * The arithmetic three lists used to each do their own way.
 *
 * It is unit tested because every one of its failures is quiet: a boundary an
 * hour out reads as a plausible number, and the only way to notice is to know
 * what the right one was.
 */

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('how long ago something happened', () => {
  it('is "now" for anything under a minute', () => {
    expect(elapsedSince(NOW, NOW)).toEqual({ unit: 'now' });
    expect(elapsedSince(NOW - 59_999, NOW)).toEqual({ unit: 'now' });
  });

  it('crosses into minutes exactly at a minute', () => {
    expect(elapsedSince(NOW - MINUTE, NOW)).toEqual({ unit: 'minutes', count: 1 });
  });

  it('floors rather than rounds', () => {
    /*
     * Ninety seconds is one minute that has passed and one that has not.
     * Rounding calls that "2m", which next to a timestamp somebody can also
     * read is simply wrong.
     */
    expect(elapsedSince(NOW - 90_000, NOW)).toEqual({ unit: 'minutes', count: 1 });
    expect(elapsedSince(NOW - 59 * MINUTE, NOW)).toEqual({ unit: 'minutes', count: 59 });
  });

  it('steps up at each boundary and not before', () => {
    expect(elapsedSince(NOW - HOUR + 1, NOW)).toEqual({ unit: 'minutes', count: 59 });
    expect(elapsedSince(NOW - HOUR, NOW)).toEqual({ unit: 'hours', count: 1 });
    expect(elapsedSince(NOW - DAY + 1, NOW)).toEqual({ unit: 'hours', count: 23 });
    expect(elapsedSince(NOW - DAY, NOW)).toEqual({ unit: 'days', count: 1 });
  });

  it('gives up on durations after a week, by default', () => {
    expect(elapsedSince(NOW - 6 * DAY, NOW)).toEqual({ unit: 'days', count: 6 });
    // "37 days ago" is not a fact anyone can do anything with.
    expect(elapsedSince(NOW - 7 * DAY, NOW)).toEqual({ unit: 'date', at: NOW - 7 * DAY });
  });

  it('keeps counting where a list asks it to', () => {
    expect(elapsedSince(NOW - 400 * DAY, NOW, { until: FOREVER })).toEqual({
      unit: 'days',
      count: 400,
    });
  });

  it('reads the future as now', () => {
    /*
     * Clocks disagree, and a row can carry a timestamp from a server a few
     * seconds ahead. "In 3 minutes" beside a query that has already run is the
     * kind of thing that makes people distrust the whole column.
     */
    expect(elapsedSince(NOW + 5 * MINUTE, NOW)).toEqual({ unit: 'now' });
  });
});
