import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleDriver } from '@ai/drivers/google';
import { OpenAiDriver, OpenAiShapedDrivers, OpenAiCompatibleDriver } from '@ai/drivers/openai';
import { runTurn } from '@ai/agent';
import { MockClient } from '@drivers/mock';
import { gatherSchema } from '@ai/schema';
import type { AiDriver, AiRequest } from '@ai/types';

interface GoogleBody {
  contents: {
    role: string;
    parts: { functionResponse?: { name: string; id?: string; response: { result: string } } }[];
  }[];
}
interface OpenAiBody {
  messages: { role: string; content: string; tool_calls: { id: string }[] }[];
}

function stream(frames: unknown[]): Response {
  return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

afterEach(() => vi.unstubAllGlobals());

async function turn(driver: AiDriver) {
  const client = new MockClient({ engine: 'mock' });
  await client.connect();
  try {
    return await runTurn(
      {
        adapter: driver.create(
          { id: 'test', name: 'Test', driver: driver.kind, model: 'test', createdAt: 0 },
          'test'
        ),
        client,
        document: await gatherSchema(client, { kind: 'connection' }, { budget: 24000 }),
        model: 'test',
        maxTokens: 1024,
        history: [],
        question: 'Count albums',
      },
      { item: () => undefined, delta: () => undefined, replace: () => undefined },
      new AbortController().signal
    );
  } finally {
    await client.disconnect();
  }
}

describe('provider tool continuations through the agent loop', () => {
  it('replays Gemini signed parts, including signature-only parts, across multiple tools', async () => {
    const first = [
      { text: 'Inspect first.', thought: true, thoughtSignature: 'thinking-signature' },
      {
        functionCall: { name: 'inspect_schema', args: { tables: ['music.album'] } },
        thoughtSignature: 'call-signature',
      },
      { thoughtSignature: 'trailing-signature' },
    ];
    const second = [
      {
        functionCall: {
          id: 'provider-query-id',
          name: 'run_sql',
          args: { sql: 'SELECT count(*) FROM album' },
        },
        thoughtSignature: 'next-signature',
      },
    ];
    const bodies: GoogleBody[] = [];
    const fetcher = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      const parts = [first, second, [{ text: 'Counted the albums.' }]][bodies.length - 1];
      return stream(
        parts!.map((part) => ({
          candidates: [{ content: { parts: [part] }, finishReason: 'STOP' }],
        }))
      );
    });
    vi.stubGlobal('fetch', fetcher);
    const result = await turn(GoogleDriver);
    expect(bodies).toHaveLength(3);
    expect(bodies[1].contents[1]).toEqual({ role: 'model', parts: first });
    expect(bodies[2].contents[1]).toEqual({ role: 'model', parts: first });
    expect(bodies[2].contents[3]).toEqual({ role: 'model', parts: second });
    expect(bodies[2].contents[4].parts[0].functionResponse).toMatchObject({
      name: 'run_sql',
      id: 'provider-query-id',
    });
    expect(bodies[1].contents[2].parts[0].functionResponse).not.toHaveProperty('id');
    expect(
      result.items.some(
        (item) =>
          item.kind === 'step' && item.tool === 'inspect_schema' && item.state === 'done'
      )
    ).toBe(true);
    expect(
      JSON.parse(bodies[2].contents[4].parts[0].functionResponse!.response.result).rows.length
    ).toBeGreaterThan(0);
    expect(
      result.items.some((item) => item.kind === 'text' && item.text.includes('Counted'))
    ).toBe(true);
  });

  it.each([OpenAiDriver, OpenAiCompatibleDriver, ...OpenAiShapedDrivers])(
    '$kind preserves reasoning and interleaved tool call arguments',
    async (driver) => {
      const bodies: OpenAiBody[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url, init) => {
          bodies.push(JSON.parse(init.body));
          if (bodies.length === 1)
            return stream([
              {
                choices: [
                  {
                    delta: {
                      reasoning_content: 'Need ',
                      reasoning: 'Work ',
                      tool_calls: [
                        {
                          index: 0,
                          id: 'query',
                          function: { name: 'run_sql', arguments: '{"sql":' },
                        },
                        {
                          index: 1,
                          id: 'schema',
                          function: { name: 'inspect_schema', arguments: '{"tables":' },
                        },
                      ],
                    },
                  },
                ],
              },
              {
                choices: [
                  {
                    delta: {
                      reasoning_content: 'rows.',
                      reasoning: 'here.',
                      tool_calls: [
                        { index: 1, function: { arguments: '["music.album"]}' } },
                        { index: 0, function: { arguments: '"SELECT count(*) FROM album"}' } },
                      ],
                    },
                    finish_reason: 'tool_calls',
                  },
                ],
              },
            ]);
          return stream([
            { choices: [{ delta: { content: 'Counted the albums.' }, finish_reason: 'stop' }] },
          ]);
        })
      );
      await turn(driver);
      expect(bodies).toHaveLength(2);
      const messages = bodies[1].messages;
      expect(messages[2]).toMatchObject({
        role: 'assistant',
        reasoning_content: 'Need rows.',
        reasoning: 'Work here.',
      });
      expect(messages[2].tool_calls.map((call) => call.id)).toEqual(['query', 'schema']);
      expect(messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'query' });
      expect(JSON.parse(messages[3].content).rows.length).toBeGreaterThan(0);
      expect(messages[4]).toMatchObject({ role: 'tool', tool_call_id: 'schema' });
    }
  );

  it('keeps ordinary Gemini history valid when there is no raw response', async () => {
    const fetcher = vi.fn(async () =>
      stream([{ candidates: [{ content: { parts: [{ text: 'Ready.' }] } }] }])
    );
    vi.stubGlobal('fetch', fetcher);
    const request: AiRequest = {
      system: 'test',
      model: 'test',
      maxTokens: 10,
      tools: [],
      messages: [
        { role: 'user', text: 'Hello' },
        { role: 'assistant', text: 'Hi', calls: [] },
        { role: 'user', text: 'Again' },
      ],
    };
    await GoogleDriver.create(
      { id: 'test', name: 'Test', driver: 'google', model: 'test', createdAt: 0 },
      'key'
    ).send(
      request,
      { text: () => undefined, thinking: () => undefined },
      new AbortController().signal
    );
    const body = JSON.parse(
      (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
    );
    expect(body.contents[1]).toEqual({ role: 'model', parts: [{ text: 'Hi' }] });
    expect(body.tools).toBeUndefined();
  });
});
