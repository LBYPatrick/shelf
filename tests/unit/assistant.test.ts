import { describe, expect, it } from 'vitest';
import type { Capabilities, DatabaseClient, ResultSet } from '@drivers/types';
import { runTurn, type TurnSink } from '@ai/agent';
import type { AiAdapter, AiReply, AiRequest, AiSink } from '@ai/types';
import type { AiItem } from '@shared/ai';
import { buildSchemaDocument } from '@shared/schemaDoc';

/**
 * The promise this feature makes, tested where it is kept.
 *
 * The live suite proves a real model can write correct SQL from what we send
 * it. It cannot prove the rule, because a well-behaved model never breaks it —
 * so the interesting case has to be constructed: an adapter that *insists* on
 * running a `DELETE`, and asks twice.
 *
 * That is the whole reason the rule lives in the agent rather than in the
 * prompt. A prompt is a request; this is the thing that says no.
 */

const CAPABILITIES = {
  sql: true,
  queryLanguage: 'sql',
  schemas: false,
  multipleDatabases: false,
  transactions: true,
  indexes: true,
  relations: true,
  triggers: false,
  partitions: false,
  views: true,
  routines: false,
  comments: true,
  ddl: true,
  sortPushdown: 'full',
  filterPushdown: 'full',
  cheapCount: true,
  streaming: true,
  sshTunnel: false,
  nativeShell: false,
  containers: false,
  statistics: false,
  nouns: { database: 'database', entity: 'table', row: 'row', column: 'column' },
} satisfies Capabilities;

/** Records every statement that actually reached a database. */
function stubClient(ran: string[]): DatabaseClient {
  const empty: ResultSet = {
    fields: [{ name: 'n' }],
    rows: [{ n: 1 }],
    truncated: false,
    rowCount: 1,
    statement: '',
    durationMs: 1,
  };

  return {
    engine: 'mock',
    capabilities: CAPABILITIES,
    query: async (text: string) => {
      ran.push(text);
      return [{ ...empty, statement: text }];
    },
    listEntities: async () => [],
    listColumns: async () => [],
    listIndexes: async () => [],
    listRelations: async () => [],
  } as unknown as DatabaseClient;
}

const DOCUMENT = buildSchemaDocument({
  engine: 'mock',
  language: 'sql',
  nouns: CAPABILITIES.nouns,
  scope: { kind: 'connection' },
  entities: [
    {
      entity: { name: 'users', kind: 'table' },
      columns: [
        { name: 'id', dataType: 'integer', nullable: false, primaryKey: true, ordinal: 1 },
      ],
    },
  ],
});

/** An adapter that says whatever it is told to say, turn by turn. */
function scriptedAdapter(turns: readonly Partial<AiReply>[], seen: AiRequest[]): AiAdapter {
  let at = 0;
  return {
    kind: 'anthropic',
    capabilities: { streaming: true, tools: true, system: true },
    async send(request: AiRequest, sink: AiSink): Promise<AiReply> {
      seen.push(request);
      const turn = turns[Math.min(at, turns.length - 1)];
      at += 1;
      if (turn?.text) sink.text(turn.text);
      return { text: '', calls: [], stop: 'end', ...turn } as AiReply;
    },
  };
}

function collect(): { sink: TurnSink; items: AiItem[] } {
  const items: AiItem[] = [];
  return {
    items,
    sink: {
      item: (item) => items.push(item),
      delta: () => undefined,
      replace: (_id, next) => items.push(...next),
    },
  };
}

/**
 * An adapter that runs its tools itself, mid-stream, the way Claude Code does.
 *
 * It writes a sentence, calls a tool, and writes another sentence — all inside
 * one `send`, which is the arrangement the ordering rule exists for.
 */
function selfDrivingAdapter(before: string, after: string): AiAdapter {
  return {
    kind: 'claudeCode',
    capabilities: { streaming: true, tools: true, system: true },
    async send(request: AiRequest, sink: AiSink): Promise<AiReply> {
      sink.text(before);
      await request.execute?.({ id: 'a', name: 'run_sql', input: { sql: 'SELECT 1' } });
      sink.text(after);
      return { text: '', calls: [], stop: 'end' };
    },
  };
}

describe('what the assistant is allowed to run', () => {
  it('runs a read and hands back the rows', async () => {
    const ran: string[] = [];
    const adapter = scriptedAdapter(
      [
        {
          calls: [{ id: 'a', name: 'run_sql', input: { sql: 'SELECT count(*) FROM users' } }],
          stop: 'tools',
        },
        { text: 'There is one.' },
      ],
      []
    );

    const { sink, items } = collect();
    const outcome = await runTurn(
      {
        adapter,
        client: stubClient(ran),
        document: DOCUMENT,
        model: 'x',
        maxTokens: 1000,
        history: [],
        question: 'how many users?',
      },
      sink,
      new AbortController().signal
    );

    expect(ran).toEqual(['SELECT count(*) FROM users']);
    // The rows ride on the step that produced them, so that the interface can
    // fold a query and its answer away as one thing.
    const done = outcome.items.filter((item) => item.kind === 'step' && item.state === 'done');
    expect(done.some((item) => item.kind === 'step' && item.rows !== undefined)).toBe(true);
    expect(items.some((item) => item.kind === 'step' && item.state === 'done')).toBe(true);
  });

  it('refuses a write, and never lets it reach the database', async () => {
    const ran: string[] = [];
    const adapter = scriptedAdapter(
      [
        {
          calls: [{ id: 'a', name: 'run_sql', input: { sql: 'DELETE FROM users' } }],
          stop: 'tools',
        },
        // Asked again, differently phrased — a model that decides the refusal
        // was about syntax rather than about permission.
        {
          calls: [
            {
              id: 'b',
              name: 'run_sql',
              input: { sql: 'WITH x AS (SELECT id FROM users) DELETE FROM users' },
            },
          ],
          stop: 'tools',
        },
        { text: 'Here is the statement instead.' },
      ],
      []
    );

    const { sink } = collect();
    const outcome = await runTurn(
      {
        adapter,
        client: stubClient(ran),
        document: DOCUMENT,
        model: 'x',
        maxTokens: 1000,
        history: [],
        question: 'delete every user',
      },
      sink,
      new AbortController().signal
    );

    // The only thing that really matters.
    expect(ran).toEqual([]);

    const denials = outcome.items.filter(
      (item) => item.kind === 'step' && item.state === 'denied'
    );
    expect(denials).toHaveLength(2);
  });

  it('tells the model what to do instead of merely saying no', async () => {
    const ran: string[] = [];
    const seen: AiRequest[] = [];
    const adapter = scriptedAdapter(
      [
        {
          calls: [{ id: 'a', name: 'run_sql', input: { sql: 'DROP TABLE users' } }],
          stop: 'tools',
        },
        { text: 'done' },
      ],
      seen
    );

    const { sink } = collect();
    await runTurn(
      {
        adapter,
        client: stubClient(ran),
        document: DOCUMENT,
        model: 'x',
        maxTokens: 1000,
        history: [],
        question: 'drop it',
      },
      sink,
      new AbortController().signal
    );

    const second = seen[1];
    const results = second?.messages.at(-1);
    expect(results?.role).toBe('tool');
    const content = results?.role === 'tool' ? (results.results[0]?.content ?? '') : '';

    /*
     * A model told "denied" apologises and stops; a model told what to do
     * instead writes the statement out. The wording is load-bearing, so it is
     * asserted rather than left to drift.
     */
    expect(content).toMatch(/refused/i);
    expect(content).toMatch(/write the statement out/i);
    expect(content).toMatch(/query tab/i);
  });

  it('refuses a statement whose verb it does not recognise', async () => {
    const ran: string[] = [];
    const adapter = scriptedAdapter(
      [
        {
          calls: [{ id: 'a', name: 'run_sql', input: { sql: 'FLUSHDB' } }],
          stop: 'tools',
        },
        { text: 'ok' },
      ],
      []
    );

    const { sink } = collect();
    await runTurn(
      {
        adapter,
        client: stubClient(ran),
        document: DOCUMENT,
        model: 'x',
        maxTokens: 1000,
        history: [],
        question: 'clear the cache',
      },
      sink,
      new AbortController().signal
    );

    expect(ran).toEqual([]);
  });

  it('offers no tools at all when the provider has none', async () => {
    const seen: AiRequest[] = [];
    const adapter: AiAdapter = {
      ...scriptedAdapter([{ text: 'no tools here' }], seen),
      capabilities: { streaming: true, tools: false, system: true },
    };

    const { sink } = collect();
    await runTurn(
      {
        adapter,
        client: stubClient([]),
        document: DOCUMENT,
        model: 'x',
        maxTokens: 1000,
        history: [],
        question: 'hello',
      },
      sink,
      new AbortController().signal
    );

    expect(seen[0]?.tools).toEqual([]);
    // ...and it is told so, rather than being left to discover it.
    expect(seen[0]?.system).toMatch(/cannot run anything/i);
  });

  it('stops rather than looping forever', async () => {
    const ran: string[] = [];
    // An adapter that only ever asks for another tool call.
    const adapter = scriptedAdapter(
      [
        {
          calls: [{ id: 'a', name: 'run_sql', input: { sql: 'SELECT 1' } }],
          stop: 'tools',
        },
      ],
      []
    );

    const { sink } = collect();
    const outcome = await runTurn(
      {
        adapter,
        client: stubClient(ran),
        document: DOCUMENT,
        model: 'x',
        maxTokens: 1000,
        history: [],
        question: 'go',
      },
      sink,
      new AbortController().signal
    );

    expect(ran.length).toBeLessThanOrEqual(6);
    expect(outcome.items.some((item) => item.kind === 'error')).toBe(true);
  });
});

describe('the order a turn is read in', () => {
  it('puts prose written after a query below the query', async () => {
    /*
     * The failure this prevents: an adapter that runs its own tools streams
     * through one `send`, so a text item created on the first delta was
     * appended to for the whole session — and a sentence written *after* a
     * query landed above the table that query returned. The reader saw "here
     * are the results" with nothing under it.
     */
    const { sink, items } = collect();
    const outcome = await runTurn(
      {
        adapter: selfDrivingAdapter('Let me check.', 'There is one.'),
        client: stubClient([]),
        document: DOCUMENT,
        model: 'x',
        maxTokens: 1000,
        history: [],
        question: 'how many?',
      },
      sink,
      new AbortController().signal
    );

    const shape = outcome.items.map((item) => item.kind);
    expect(shape).toEqual(['text', 'step', 'text']);
    expect(outcome.items[0]).toMatchObject({ text: 'Let me check.' });
    expect(outcome.items[2]).toMatchObject({ text: 'There is one.' });

    // And the interface was told the same thing, in the same order — the store
    // draws from the stream, not from the value the turn resolves with.
    expect(items.filter((item) => item.kind === 'step')).toHaveLength(2);
  });

  it('sends the whole of what the model said back as one assistant turn', async () => {
    // Closing an item off empties its buffer; the wire message must still carry
    // everything, or the model loses its own words on the next round.
    const seen: AiRequest[] = [];
    const adapter: AiAdapter = {
      kind: 'claudeCode',
      capabilities: { streaming: true, tools: true, system: true },
      async send(request: AiRequest, sink: AiSink): Promise<AiReply> {
        seen.push(request);
        if (seen.length > 1) return { text: '', calls: [], stop: 'end' };
        sink.text('First. ');
        await request.execute?.({ id: 'a', name: 'run_sql', input: { sql: 'SELECT 1' } });
        sink.text('Second.');
        return {
          text: '',
          calls: [{ id: 'b', name: 'run_sql', input: { sql: 'SELECT 2' } }],
          stop: 'tools',
        };
      },
    };

    const { sink } = collect();
    await runTurn(
      {
        adapter,
        client: stubClient([]),
        document: DOCUMENT,
        model: 'x',
        maxTokens: 1000,
        history: [],
        question: 'how many?',
      },
      sink,
      new AbortController().signal
    );

    const sent = seen[1]?.messages.find((message) => message.role === 'assistant');
    expect(sent?.role === 'assistant' && sent.text).toBe('First. Second.');
  });
});
