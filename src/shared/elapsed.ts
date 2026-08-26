/**
 * How long ago something happened, as a fact rather than as a phrase.
 *
 * Three lists in this app say this — the connections on the start screen, the
 * query history, the saved chats — and each had worked it out for itself. They
 * disagreed on all three things there are to disagree about: where the
 * boundaries fall (`< 1 minute` in two of them, `< 60 seconds` in the third),
 * whether rounding or flooring (an event fifty seconds old was "just now" in
 * one list and "1m" in another, on the same screen), and what happens past a
 * week. One of the three was not translated at all, because a component that
 * builds its own phrase is a component that can forget.
 *
 * So the arithmetic is here and the wording is not. What comes back names a
 * unit and a count, and each list turns that into its own words with its own
 * keys — which is the part that genuinely differs, because "2d" beside a query
 * and "2 days ago" beside a connection are both right for where they sit.
 *
 * `now` is a parameter rather than a call to the clock. That is what makes this
 * testable at all: a function that reads `Date.now()` can only be tested by
 * arranging for time to pass.
 */

export type Elapsed =
  | { readonly unit: 'now' }
  | { readonly unit: 'minutes'; readonly count: number }
  | { readonly unit: 'hours'; readonly count: number }
  | { readonly unit: 'days'; readonly count: number }
  /** Old enough that a duration stops being useful and a date starts. */
  | { readonly unit: 'date'; readonly at: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export interface ElapsedOptions {
  /**
   * Past this, the answer is a date.
   *
   * A week for a list you scan by recency; `Infinity` for one where "412 days"
   * is still the useful answer.
   */
  readonly until?: number;
}

/**
 * Floors rather than rounds, deliberately.
 *
 * Rounding makes a thing that happened ninety seconds ago "2m", which is a
 * count of minutes that have not finished passing — and next to a timestamp
 * somebody can also read, it is simply wrong. Flooring says how much time has
 * definitely gone by.
 *
 * A future instant reads as now. Clocks disagree, a row can carry a timestamp
 * from a server a few seconds ahead, and "in 3 minutes" beside a query that has
 * already run is the kind of thing that makes people distrust the whole column.
 */
export function elapsedSince(at: number, now: number, options: ElapsedOptions = {}): Elapsed {
  const since = Math.max(0, now - at);
  const until = options.until ?? WEEK;

  if (since >= until) return { unit: 'date', at };
  if (since < MINUTE) return { unit: 'now' };
  if (since < HOUR) return { unit: 'minutes', count: Math.floor(since / MINUTE) };
  if (since < DAY) return { unit: 'hours', count: Math.floor(since / HOUR) };
  return { unit: 'days', count: Math.floor(since / DAY) };
}

/** For the lists that keep counting rather than falling back to a date. */
export const FOREVER = Number.POSITIVE_INFINITY;
