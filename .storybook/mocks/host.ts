import type { HostChannel, HostPayload, HostResult } from '@shared/contract';
import { host } from '@renderer/lib/host';
import { RpcCancelled } from '@shared/rpc';
import {
  CAPABILITIES,
  COLUMNS,
  ENTITIES,
  FIELDS,
  INDEXES,
  RELATIONS,
  RESULT,
  ROWS,
  TRIGGERS,
  key,
} from '../fixtures/database';

/**
 * The connection host, without a connection host.
 *
 * The renderer talks to the database over a `MessagePort` handed to it by the
 * main process — which does not exist in a browser. Rather than fake a port and
 * a protocol on top of it, the client's two methods are replaced outright: this
 * is the seam the rest of the app is written against, and everything above it
 * is unchanged and therefore worth looking at.
 *
 * Answers come from the fixtures, so a story showing a table shows the same
 * table every time and a visual difference means someone changed something.
 * Latency is deliberate: resolving synchronously would hide every skeleton and
 * spinner in the app, and a loading state nobody can see is a loading state
 * nobody reviews.
 */

/** Overridden per story, for the ones that are *about* an unusual answer. */
type Answers = Partial<{
  [K in HostChannel]: (payload: HostPayload<K>) => HostResult<K> | Promise<HostResult<K>>;
}>;

let overrides: Answers = {};

/** How long a host call takes here. A story may ask for longer, or for never. */
let latency = 120;

export function setHostAnswers(next: Answers, ms = 120): void {
  overrides = next;
  latency = ms;
}

export function resetHost(): void {
  overrides = {};
  latency = 120;
}

const DEFAULTS: Answers = {
  'conn/open': () => ({ capabilities: CAPABILITIES, version: 'PostgreSQL 17.2' }),
  'conn/test': () => ({ ok: true as const, version: 'PostgreSQL 17.2' }),
  'conn/close': () => undefined,
  'conn/ping': () => undefined,

  'schema/databases': () => ['records', 'analytics'],
  'schema/schemas': () => ['music', 'ops'],
  'schema/entities': () => ENTITIES,
  'schema/columns': ({ entity }) => COLUMNS[key(entity.name, entity.schema)] ?? [],
  'schema/indexes': ({ entity }) => INDEXES[key(entity.name, entity.schema)] ?? [],
  'schema/relations': ({ entity }) => RELATIONS[key(entity.name, entity.schema)] ?? [],
  'schema/triggers': ({ entity }) => TRIGGERS[key(entity.name, entity.schema)] ?? [],
  'schema/partitions': () => [],
  'schema/properties': () => ({
    rowCount: 1_284,
    dataSizeBytes: 2_310_144,
    indexSizeBytes: 442_368,
    comment: 'Everything we have ever pressed.',
  }),
  'schema/container': () => ({
    facts: [
      { key: 'owner', text: 'shelf' },
      { key: 'encoding', text: 'UTF8' },
      { key: 'size', bytes: 18_874_368 },
      { key: 'tables', count: 9 },
    ],
    largest: [
      { entity: { name: 'track', schema: 'music' }, bytes: 9_437_184 },
      { entity: { name: 'album', schema: 'music' }, bytes: 4_194_304 },
    ],
  }),

  'data/select': () => ({ rows: ROWS, fields: FIELDS, totalRowCount: ROWS.length }),
  'data/selectSql': () => 'SELECT * FROM "music"."album" LIMIT 100',
  'data/count': () => ROWS.length,

  'query/run': () => [RESULT],
  'query/editability': ({ fields }) =>
    fields.map((field) => ({
      field: field.name,
      editable: field.name !== 'runtime_seconds',
      ...(field.name === 'runtime_seconds' ? { reason: 'computed-column' as const } : {}),
    })),

  'changes/apply': () => undefined,
  'changes/preview': () => "UPDATE \"music\".\"album\" SET title = 'x' WHERE id = 1;",

  /*
   * A machine with Claude Code on it and no Codex, so the stories show both
   * halves of the list at once: one provider that was found and the ones that
   * were configured.
   */
  'ai/installed': () => ['claudeCode' as const],

  'ai/schema': () => ({
    kind: 'shelf.schema' as const,
    version: 1,
    engine: 'postgres' as const,
    language: 'sql',
    nouns: CAPABILITIES.nouns,
    scope: { kind: 'connection' as const },
    tables: [],
  }),
};

/**
 * Installs the fake. Called once from the preview, before any story renders.
 *
 * The client is a singleton, so this replaces methods on it rather than
 * constructing another one — every store already holds a reference to that
 * object.
 */
export function installHost(): void {
  const client = host as unknown as {
    call: (channel: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>;
    on: (channel: string, listener: (payload: unknown) => void) => () => void;
  };

  client.call = (channel, payload, signal) =>
    new Promise((resolve, reject) => {
      const answer = (overrides as Record<string, unknown>)[channel] ??
        (DEFAULTS as Record<string, unknown>)[channel];

      if (typeof answer !== 'function') {
        reject(new Error(`No story answer for ${channel}`));
        return;
      }

      // Never resolves, for the stories that are about waiting.
      if (latency < 0) return;

      const timer = setTimeout(() => {
        try {
          resolve((answer as (p: unknown) => unknown)(payload));
        } catch (error) {
          reject(error);
        }
      }, latency);

      /*
       * Cancellation is real here too. A story showing a cancelled query is
       * worth having, and it only works if abandoning the call actually
       * rejects the promise the component is awaiting.
       */
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new RpcCancelled());
        },
        { once: true }
      );
    });

  // Nothing pushes events in a storybook; a listener that is never called is
  // still an unsubscribe the caller expects to be able to run.
  client.on = () => () => undefined;
}
