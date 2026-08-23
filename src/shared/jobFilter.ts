/**
 * Which of the dispatched jobs a reader is asking to see.
 *
 * A job list is a log: it only grows, and the thing worth finding in it is
 * rarely the most recent thing in it. Five questions cover almost every search
 * anyone actually makes of one — what was it called, how did it end, when did
 * it start, when did it finish, and how long did it take — so those are the
 * five dimensions, and nothing here invents a sixth.
 *
 * Pure, and here rather than in the component, because a predicate over time
 * windows is exactly the kind of code that is wrong by one boundary and looks
 * right: a job that finished four seconds ago dropping out of "last hour"
 * produces a shorter list, not an error. The clock is a parameter for the same
 * reason — a function that reads `Date.now()` cannot be asked about a Tuesday.
 */

export type JobState = 'pending' | 'running' | 'done' | 'failed';

/** Running and pending are one answer: both mean "not finished yet". */
export type StatusChoice = 'any' | JobState | 'active';

export type WhenChoice = 'any' | 'hour' | 'today' | 'week';

/**
 * Bands rather than ceilings.
 *
 * "Under ten seconds" and "under a minute" overlap, so a list narrowed by one
 * and then the other changes in a way the reader has to reason about. Bands
 * partition: every job is in exactly one, and picking a second is picking a
 * different set rather than a subset of the first.
 */
export type TookChoice = 'any' | 'instant' | 'seconds' | 'minute' | 'long';

export interface JobFilter {
  /** Matched against the name, case-insensitively, anywhere in it. */
  text: string;
  status: StatusChoice;
  started: WhenChoice;
  finished: WhenChoice;
  took: TookChoice;
}

/** What the fields mean, and what "no filter at all" is. */
export const NO_FILTER: JobFilter = {
  text: '',
  status: 'any',
  started: 'any',
  finished: 'any',
  took: 'any',
};

/** Only what a filter reads. The store's `Job` satisfies it. */
export interface FilterableJob {
  readonly name: string;
  readonly status: JobState;
  readonly startedAt: number;
  readonly finishedAt?: number;
}

const HOUR = 60 * 60 * 1000;
const WEEK = 7 * 24 * HOUR;

/**
 * The earliest moment a window admits, or `undefined` for "any".
 *
 * "Today" is the local midnight just gone rather than twenty-four hours ago,
 * because that is what the word means to the person reading it: at nine in the
 * morning, "today" is not "since nine yesterday".
 */
function floorOf(choice: WhenChoice, now: number): number | undefined {
  switch (choice) {
    case 'hour':
      return now - HOUR;
    case 'today': {
      const midnight = new Date(now);
      midnight.setHours(0, 0, 0, 0);
      return midnight.getTime();
    }
    case 'week':
      return now - WEEK;
    default:
      return undefined;
  }
}

function statusMatches(status: JobState, choice: StatusChoice): boolean {
  if (choice === 'any') return true;
  if (choice === 'active') return status === 'running' || status === 'pending';
  return status === choice;
}

/**
 * How long it took, or — for one still going — how long it has taken so far.
 *
 * A job running for ten minutes belongs in "over a minute" while it is still
 * running. Waiting for it to finish before it can be found by its length hides
 * exactly the job somebody filtering by length is looking for.
 */
export function jobDuration(job: FilterableJob, now: number): number {
  return Math.max(0, (job.finishedAt ?? now) - job.startedAt);
}

function tookMatches(elapsed: number, choice: TookChoice): boolean {
  switch (choice) {
    case 'instant':
      return elapsed < 1000;
    case 'seconds':
      return elapsed >= 1000 && elapsed < 10_000;
    case 'minute':
      return elapsed >= 10_000 && elapsed < 60_000;
    case 'long':
      return elapsed >= 60_000;
    default:
      return true;
  }
}

export function matchesJob(job: FilterableJob, filter: JobFilter, now: number): boolean {
  const text = filter.text.trim().toLowerCase();
  if (text && !job.name.toLowerCase().includes(text)) return false;

  if (!statusMatches(job.status, filter.status)) return false;

  const startedFloor = floorOf(filter.started, now);
  if (startedFloor !== undefined && job.startedAt < startedFloor) return false;

  const finishedFloor = floorOf(filter.finished, now);
  if (finishedFloor !== undefined) {
    // Asking when something finished is asking about finished things.
    if (job.finishedAt === undefined || job.finishedAt < finishedFloor) return false;
  }

  return tookMatches(jobDuration(job, now), filter.took);
}

/**
 * How many of the four dimensions are narrowing the list.
 *
 * The text is not counted: it is legible in the field it was typed into, and a
 * badge is for the choices that are folded away out of sight. A control that
 * says "2" while the reader can see only one cause of it is a control that
 * raises a question instead of answering one.
 */
export function narrowedBy(filter: JobFilter): number {
  return [filter.status, filter.started, filter.finished, filter.took].filter(
    (choice) => choice !== 'any'
  ).length;
}

/** Whether the list is a moving target — the windows are relative to now. */
export function tracksTheClock(filter: JobFilter): boolean {
  return filter.started !== 'any' || filter.finished !== 'any' || filter.took !== 'any';
}
