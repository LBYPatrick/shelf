import type { JobFilter } from '@shared/jobFilter';
import { useAssistant } from '@renderer/stores/assistant';
import { useConnections } from '@renderer/stores/connections';
import { useEntities } from '@renderer/stores/entities';
import { useJobs } from '@renderer/stores/jobs';
import { useQueries } from '@renderer/stores/queries';
import { useTabs } from '@renderer/stores/tabs';
import { useToasts } from '@renderer/stores/toasts';
import { ENTITIES, LIVE_CONNECTION, SAVED_CONNECTIONS } from './fixtures/database';

/**
 * Putting a store into the state a story is about.
 *
 * Half the components in this app take no props worth speaking of: they read a
 * store and draw it. A story for one of those is a *store*, not an argument
 * list, so these exist to write that store in one line and keep the setup out
 * of every story file.
 *
 * Each one returns nothing and is called from a story's `setup`, after the
 * preview decorator has installed a fresh Pinia. Nothing here reaches for the
 * host — that is already faked — so a store seeded here and then refreshed
 * agrees with itself.
 */

/** An open connection, which most of the workspace needs before it draws. */
export function connected(): void {
  const connections = useConnections();
  connections.saved = [...SAVED_CONNECTIONS];
  connections.active = LIVE_CONNECTION;
}

/** The entity tree, expanded to the depth a story wants to show. */
export function withEntities(options: { expand?: readonly string[] } = {}): void {
  connected();
  const entities = useEntities();
  entities.entities = [...ENTITIES];
  entities.schemas = ['music', 'ops'];
  entities.loading = false;
  entities.error = null;
  for (const key of options.expand ?? []) entities.expanded.add(key);
}

const MINUTE = 60_000;

/**
 * A handful of jobs, in every state a card can be in.
 *
 * Deliberately includes a name long enough to wrap to two lines: the card's
 * hover behaviour was wrong for a year and the short default name is exactly
 * why nobody caught it.
 */
export function withJobs(filter?: Partial<JobFilter>): void {
  connected();
  const jobs = useJobs();
  const now = Date.now();

  jobs.jobs = [
    {
      id: 'j1',
      name: 'client5 batch 004 shard 000 rebuild',
      connectionId: 'conn-local',
      database: 'records',
      sql: 'select * from music.track',
      status: 'done',
      rows: 328_487,
      fields: [{ name: 'id' }, { name: 'title' }],
      path: '/tmp/spool-j1',
      startedAt: now - 8 * MINUTE,
      finishedAt: now - 4 * MINUTE,
    },
    {
      id: 'j2',
      name: 'june refunds',
      connectionId: 'conn-local',
      database: 'records',
      sql: 'select * from ops.daily_metrics',
      status: 'running',
      rows: 0,
      fields: [],
      startedAt: now - 42_000,
    },
    {
      id: 'j3',
      name: 'records-20260310-090405',
      connectionId: 'conn-local',
      database: 'records',
      sql: 'select * from music.artistt',
      status: 'failed',
      rows: 0,
      fields: [],
      error: 'relation "music.artistt" does not exist',
      startedAt: now - 3 * 60 * MINUTE,
      finishedAt: now - 3 * 60 * MINUTE + 300,
    },
  ];

  if (filter) jobs.filter = { ...jobs.filter, ...filter };
}

/** Saved queries and history, which share a store. */
export function withQueries(): void {
  connected();
  const queries = useQueries();
  void queries.refresh();
}

/** Conversations, as the sidebar's cards see them. */
export function withChats(): void {
  connected();
  const assistant = useAssistant();
  const now = Date.now();

  // Cleared, because the term lives in the store and a story that left one set
  // would narrow the next story's list with no field on screen saying why.
  assistant.filter = { text: '', criteria: [] };

  assistant.chats = [
    {
      id: 'c1',
      connectionId: 'conn-local',
      title: 'How many rows are in music.album',
      body: '',
      createdAt: now - 40 * MINUTE,
      updatedAt: now - 90_000,
    },
    {
      id: 'c2',
      connectionId: 'conn-local',
      title: 'The ten customers who spent the most last month',
      body: '',
      createdAt: now - 26 * 60 * MINUTE,
      updatedAt: now - 25 * 60 * MINUTE,
    },
    {
      id: 'c3',
      connectionId: 'conn-local',
      title: 'Why is the track join slow',
      body: '',
      createdAt: now - 9 * 24 * 60 * MINUTE,
      updatedAt: now - 9 * 24 * 60 * MINUTE,
    },
  ];
}

/** A provider on file, for the stories that are about a configured assistant. */
export function withProvider(): void {
  const assistant = useAssistant();
  assistant.providers = [
    { id: 'p1', name: 'Claude Code', driver: 'claudeCode', model: 'default', createdAt: 0 },
  ];
  assistant.preferredId = 'p1';
}

/** Tabs, for the strip and the workspace. */
export function withTabs(): void {
  connected();
  const tabs = useTabs();
  tabs.openEntity('table', { name: 'album', schema: 'music' });
  tabs.openQuery('select * from music.album');
}

export function withToast(): void {
  useToasts().show({ tone: 'success', message: 'Exported 64 rows to albums.csv' });
}
