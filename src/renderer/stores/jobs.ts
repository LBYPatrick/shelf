import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Field } from '@drivers/types';
import { errorMessage } from '@shared/errors';
import { host } from '../lib/host';
import { saveSetting } from '../lib/settings';
import { i18next } from '../i18n';

/**
 * Dispatched queries, and what became of them.
 *
 * A run is something you watch; a job is something you start. The distinction
 * is worth a subsystem because the two want opposite things from the interface:
 * a run holds the tab until it answers and shows you the first page, and a job
 * releases the tab immediately, keeps its whole answer, and tells you when it
 * is finished.
 *
 * The rows themselves are never here. They are spooled to a file by the host —
 * see `utility/spool.ts` — and this store holds only what a list needs to draw
 * a row and what the viewer needs to ask for a page.
 */

export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface Job {
  readonly id: string;
  name: string;
  readonly connectionId: string;
  /** Named after the database it ran against, which is what a list needs. */
  readonly database: string;
  readonly sql: string;
  status: JobStatus;
  rows: number;
  fields: readonly Field[];
  /** Where the host spooled the answer; absent until it has one. */
  path?: string;
  error?: string;
  readonly startedAt: number;
  finishedAt?: number;
}

/**
 * `<database>-YYYYMMDD-hhmmss`, in local time.
 *
 * Local rather than UTC because the name is read by the person who started it,
 * and a job they started at nine in the morning should say so. Sortable because
 * the fields run largest to smallest, which is the only reason to write a date
 * this way at all.
 */
export function defaultJobName(database: string, at: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp =
    `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `${database || 'query'}-${stamp}`;
}

/** What is kept between launches. The spool may not survive; the record does. */
const STORAGE_KEY = 'jobs';

/** Enough history to be useful, few enough that the list stays a list. */
const KEEP = 100;

let counter = 0;

export const useJobs = defineStore('jobs', () => {
  const jobs = ref<Job[]>([]);
  const loaded = ref(false);

  const running = computed(() =>
    jobs.value.filter((job) => job.status === 'running' || job.status === 'pending')
  );

  /** Newest first: a list of things that happened reads backwards. */
  const ordered = computed(() => [...jobs.value].sort((a, b) => b.startedAt - a.startedAt));

  function persist(): void {
    void saveSetting(
      STORAGE_KEY,
      jobs.value.slice(0, KEEP).map((job) => ({ ...job }))
    ).catch(() => undefined);
  }

  async function restore(): Promise<void> {
    if (loaded.value) return;
    loaded.value = true;

    const stored = await window.shelf.db
      .getSetting<readonly Job[]>(STORAGE_KEY, [])
      .catch(() => []);

    /*
     * A job that was running when the window closed did not survive it: the
     * host went with the window and nothing is draining that cursor any more.
     * Saying "running" about it forever is the one thing the list must not do.
     */
    jobs.value = stored.map((job) =>
      job.status === 'running' || job.status === 'pending'
        ? { ...job, status: 'failed' as const, error: i18next.t('jobs.interrupted') }
        : { ...job }
    );
  }

  function find(id: string): Job | undefined {
    return jobs.value.find((job) => job.id === id);
  }

  function rename(id: string, name: string): void {
    const job = find(id);
    if (!job) return;
    job.name = name.trim() || job.name;
    jobs.value = [...jobs.value];
    persist();
  }

  /**
   * Starts one, and returns as soon as it has started.
   *
   * The promise it hands back resolves when the job *finishes*, which is what
   * a caller wanting to raise a toast needs — but nothing has to await it, and
   * the tab that dispatched it does not.
   */
  function dispatch(options: { connectionId: string; database: string; sql: string }): {
    job: Job;
    finished: Promise<Job>;
  } {
    counter += 1;
    const startedAt = Date.now();

    const job: Job = {
      id: `job-${startedAt}-${counter}`,
      name: defaultJobName(options.database, new Date(startedAt)),
      connectionId: options.connectionId,
      database: options.database,
      sql: options.sql,
      status: 'pending',
      rows: 0,
      fields: [],
      startedAt,
    };

    jobs.value = [job, ...jobs.value].slice(0, KEEP);
    persist();

    const finished = (async () => {
      job.status = 'running';
      jobs.value = [...jobs.value];

      try {
        const result = await host.call('job/run', {
          connectionId: options.connectionId,
          jobId: job.id,
          text: options.sql,
        });

        job.status = 'done';
        job.rows = result.rows;
        job.fields = result.fields;
        job.path = result.path;
      } catch (caught) {
        job.status = 'failed';
        job.error = errorMessage(caught);
      } finally {
        job.finishedAt = Date.now();
        jobs.value = [...jobs.value];
        persist();
      }

      return job;
    })();

    return { job, finished };
  }

  /** Forgets a job, and takes its rows off the disk with it. */
  async function remove(id: string): Promise<void> {
    const job = find(id);
    if (!job) return;

    if (job.path) await host.call('job/discard', { path: job.path }).catch(() => undefined);
    jobs.value = jobs.value.filter((entry) => entry.id !== id);
    persist();
  }

  return { jobs, ordered, running, restore, dispatch, rename, remove, find };
});
