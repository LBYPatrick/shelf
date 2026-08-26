/**
 * Which of the dispatched jobs a reader is asking to see.
 *
 * A job list is a log: it only grows, and the thing worth finding in it is
 * rarely the most recent thing in it. Five questions cover almost every search
 * anyone actually makes of one — what was it called, how did it end, when did
 * it start, when did it finish, and how long did it take — so those are the
 * five dimensions, and nothing here invents a sixth.
 *
 * They used to be five *fields*, each holding `'any'` when it was off. That
 * shape cannot express the one thing a filter most needs to do: be switched off
 * without being forgotten. Narrowing a hundred jobs is iterative — you add a
 * condition, look, take it off, look again, put it back — and a model where
 * "off" and "unset" are the same value makes every one of those a retype.
 *
 * So a filter is a *list of criteria*, each with a value and a switch. The
 * interface draws them as chips: one per criterion, crossed out when disabled,
 * removed when discarded. Order is the order they were added, because that is
 * the order the reader thought of them in.
 *
 * Pure, and here rather than in the component, because a predicate over time
 * windows is exactly the kind of code that is wrong by one boundary and looks
 * right: a job that finished four seconds ago dropping out of "last hour"
 * produces a shorter list, not an error. The clock is a parameter for the same
 * reason — a function that reads `Date.now()` cannot be asked about a Tuesday.
 */

export type JobState = 'pending' | 'running' | 'done' | 'failed';

/** Running and pending are one answer: both mean "not finished yet". */
export type StatusChoice = JobState | 'active';

export type WhenChoice = 'hour' | 'today' | 'week';

/**
 * Bands rather than ceilings.
 *
 * "Under ten seconds" and "under a minute" overlap, so a list narrowed by one
 * and then the other changes in a way the reader has to reason about. Bands
 * partition: every job is in exactly one, and picking a second is picking a
 * different set rather than a subset of the first.
 */
export type TookChoice = 'instant' | 'seconds' | 'minute' | 'long';

export type CriterionKind = 'status' | 'started' | 'finished' | 'took';

/**
 * One condition, and whether it is currently being applied.
 *
 * `value` is typed as a string rather than a union of the four choice types
 * because a criterion is stored, restored and rendered generically — the kind
 * decides how the value is read, and `matches` is the one place that knows.
 */
export interface Criterion {
  readonly kind: CriterionKind;
  readonly value: string;
  readonly enabled: boolean;
}

export interface JobFilter {
  /** Matched against the name, case-insensitively, anywhere in it. */
  text: string;
  criteria: Criterion[];
}

/** What "no filter at all" is. */
export const NO_FILTER: JobFilter = { text: '', criteria: [] };

/** Only what a filter reads. The store's `Job` satisfies it. */
export interface FilterableJob {
  readonly name: string;
  readonly status: JobState;
  readonly startedAt: number;
  readonly finishedAt?: number;
}

const HOUR = 60 * 60 * 1000;
const WEEK = 7 * 24 * HOUR;

/** The choices each kind offers, in the order they are worth asking. */
export const CHOICES: Readonly<Record<CriterionKind, readonly string[]>> = {
  status: ['active', 'done', 'failed', 'pending'],
  started: ['hour', 'today', 'week'],
  finished: ['hour', 'today', 'week'],
  took: ['instant', 'seconds', 'minute', 'long'],
};

/**
 * The earliest moment a window admits.
 *
 * "Today" is the local midnight just gone rather than twenty-four hours ago,
 * because that is what the word means to the person reading it: at nine in the
 * morning, "today" is not "since nine yesterday".
 */
function floorOf(choice: string, now: number): number | undefined {
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

function statusMatches(status: JobState, choice: string): boolean {
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

function tookMatches(elapsed: number, choice: string): boolean {
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

/** One condition against one job. A disabled criterion is not asked. */
function matchesCriterion(job: FilterableJob, criterion: Criterion, now: number): boolean {
  switch (criterion.kind) {
    case 'status':
      return statusMatches(job.status, criterion.value);

    case 'started': {
      const floor = floorOf(criterion.value, now);
      return floor === undefined || job.startedAt >= floor;
    }

    case 'finished': {
      const floor = floorOf(criterion.value, now);
      if (floor === undefined) return true;
      // Asking when something finished is asking about finished things.
      return job.finishedAt !== undefined && job.finishedAt >= floor;
    }

    case 'took':
      return tookMatches(jobDuration(job, now), criterion.value);
  }
}

export function matchesJob(job: FilterableJob, filter: JobFilter, now: number): boolean {
  const text = filter.text.trim().toLowerCase();
  if (text && !job.name.toLowerCase().includes(text)) return false;

  /*
   * Every enabled criterion has to hold — including two of the same kind. Two
   * status chips are a contradiction that matches nothing, and that is the
   * honest answer: the reader can see both chips and can switch one off, which
   * is exactly what the switch is for. Silently letting the second replace the
   * first would be the interface deciding which of two things they meant.
   */
  return filter.criteria.every(
    (criterion) => !criterion.enabled || matchesCriterion(job, criterion, now)
  );
}

/**
 * How many criteria are narrowing the list.
 *
 * The text is not counted: it is legible in the field it was typed into, and a
 * badge is for what the reader might not be able to see. A disabled chip is not
 * counted either — it is on screen, visibly crossed out, and counting it would
 * make the badge disagree with the row beneath it.
 */
export function narrowedBy(filter: JobFilter): number {
  return filter.criteria.filter((criterion) => criterion.enabled).length;
}

/** Whether the list is a moving target — the windows are relative to now. */
export function tracksTheClock(filter: JobFilter): boolean {
  return filter.criteria.some((criterion) => criterion.enabled && criterion.kind !== 'status');
}

/* ------------------------------------------------------------- editing */

export function addCriterion(filter: JobFilter, kind: CriterionKind, value: string): JobFilter {
  return { ...filter, criteria: [...filter.criteria, { kind, value, enabled: true }] };
}

export function removeCriterion(filter: JobFilter, at: number): JobFilter {
  return { ...filter, criteria: filter.criteria.filter((_criterion, index) => index !== at) };
}

/** Switches one off, or back on, keeping it and its value where they were. */
export function toggleCriterion(filter: JobFilter, at: number): JobFilter {
  return {
    ...filter,
    criteria: filter.criteria.map((criterion, index) =>
      index === at ? { ...criterion, enabled: !criterion.enabled } : criterion
    ),
  };
}
