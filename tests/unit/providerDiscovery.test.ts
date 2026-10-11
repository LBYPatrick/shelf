import { afterEach, expect, it, vi } from 'vitest';
import { CONFIGURABLE_DRIVERS } from '@shared/aiDrivers';
import { createAiAdapter } from '@ai/registry';
import { runTurn } from '@ai/agent';
import { gatherSchema } from '@ai/schema';
import { MockClient } from '@drivers/mock';

// SDK transports own HTTP framing; exercise Shelf's actual SDK adapter with
// streamed SDK results. Fetch-based adapters below use their real SSE parsers.
const sdk = vi.hoisted(() => ({
  bodies: [] as Record<string, unknown>[],
  next: undefined as undefined | ((index: number) => unknown),
}));
vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    static APIError = class extends Error {};
    messages = {
      stream(body: Record<string, unknown>) {
        const index = sdk.bodies.push(body) - 1;
        const callbacks = new Map<string, (text: string) => void>();
        return {
          on(event: string, callback: (text: string) => void) {
            callbacks.set(event, callback);
          },
          async finalMessage() {
            const message = sdk.next!(index) as { content: { type: string; text?: string }[] };
            for (const block of message.content)
              if (block.type === 'text') callbacks.get('text')?.(block.text!);
            return message;
          },
        };
      },
    };
  }
  return { default: Anthropic };
});
vi.mock('@anthropic-ai/bedrock-sdk', async () => {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return { AnthropicBedrock: class extends Anthropic {} };
});
afterEach(() => {
  vi.unstubAllGlobals();
  sdk.bodies.length = 0;
  sdk.next = undefined;
});

const calls = [
  { name: 'inspect_schema', input: { tables: [], search: ['revenue_net_cents'] } },
  { name: 'inspect_schema', input: { tables: ['ops.daily_metrics'] } },
  {
    name: 'run_sql',
    input: {
      sql: 'SELECT region, revenue_net_cents FROM ops.daily_metrics LIMIT 5',
      intent: 'answer',
    },
  },
];
const sse = (frame: unknown) =>
  new Response(`data: ${JSON.stringify(frame)}\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  });

it.each(CONFIGURABLE_DRIVERS)(
  '$kind carries discovery, inspection, query results and the final answer',
  async (info) => {
    const bodies: Record<string, unknown>[] = [];
    const anthropic = info.kind === 'anthropic' || info.kind === 'bedrock';
    sdk.next = (index) => ({
      content:
        index < calls.length
          ? [
              {
                type: 'tool_use',
                id: `call-${index}`,
                name: calls[index]!.name,
                input: calls[index]!.input,
              },
            ]
          : [{ type: 'text', text: 'Found the rows.' }],
      stop_reason: index < calls.length ? 'tool_use' : 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const index = bodies.push(JSON.parse(init.body)) - 1;
        if (info.kind === 'google')
          return sse({
            candidates: [
              {
                content: {
                  parts:
                    index < calls.length
                      ? [
                          {
                            functionCall: {
                              id: `call-${index}`,
                              name: calls[index]!.name,
                              args: calls[index]!.input,
                            },
                            thoughtSignature: `signature-${index}`,
                          },
                        ]
                      : [{ text: 'Found the rows.' }],
                },
                finishReason: 'STOP',
              },
            ],
          });
        return sse({
          choices: [
            {
              delta:
                index < calls.length
                  ? {
                      tool_calls: [
                        {
                          index: 0,
                          id: `call-${index}`,
                          type: 'function',
                          function: {
                            name: calls[index]!.name,
                            arguments: JSON.stringify(calls[index]!.input),
                          },
                        },
                      ],
                    }
                  : { content: 'Found the rows.' },
              finish_reason: index < calls.length ? 'tool_calls' : 'stop',
            },
          ],
        });
      })
    );
    const client = new MockClient({ engine: 'mock' });
    await client.connect();
    try {
      const document = await gatherSchema(
        client,
        { kind: 'entity', entity: { name: 'album', schema: 'music' } },
        { budget: 24000 }
      );
      const result = await runTurn(
        {
          adapter: createAiAdapter(
            {
              id: 'test',
              name: info.label,
              driver: info.kind,
              model: 'test',
              createdAt: 0,
              baseUrl: info.kind === 'bedrock' ? 'us-east-1' : 'https://provider.invalid',
            },
            'test'
          ),
          client,
          document,
          model: 'test',
          maxTokens: 1000,
          history: [],
          question: 'Show revenue_net_cents by region.',
        },
        { item: () => undefined, delta: () => undefined, replace: () => undefined },
        new AbortController().signal
      );
      const requests = anthropic ? sdk.bodies : bodies;
      expect(requests).toHaveLength(4);
      expect(JSON.stringify(requests[0])).toContain('search');
      expect(JSON.stringify(requests[0])).toContain('before asking');
      // Only the tool response can supply this out-of-scope schema. Verify it is
      // carried back to each provider, rather than checking a canned final answer.
      const second = requests[1] as {
        messages: { content: string | { content: string }[] }[];
        contents: { parts: { functionResponse: { response: { result: string } } }[] }[];
      };
      const content = anthropic
        ? (second.messages.at(-1)!.content as { content: string }[])[0]!.content
        : info.kind === 'google'
          ? second.contents.at(-1)!.parts[0]!.functionResponse.response.result
          : (second.messages.at(-1)!.content as string);
      const discovered = JSON.parse(content);
      expect(
        discovered.tables.some((table: { name: string }) => table.name === 'daily_metrics')
      ).toBe(true);
      expect(
        discovered.tables.some((table: { columns: { name: string }[] }) =>
          table.columns.some((column) => column.name === 'revenue_net_cents')
        )
      ).toBe(true);
      expect(
        result.items.filter((item) => item.kind === 'step' && item.state === 'done')
      ).toHaveLength(3);
      expect(
        result.items.some(
          (item) =>
            item.kind === 'step' &&
            item.tool === 'run_sql' &&
            item.rows &&
            item.rows.rows.length > 0
        )
      ).toBe(true);
      expect(
        result.items.some(
          (item) => item.kind === 'text' && item.text.includes('Found the rows')
        )
      ).toBe(true);
    } finally {
      await client.disconnect();
    }
  }
);
