import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { MockClient } from '@drivers/mock';
import { runTurn } from '@ai/agent';
import { gatherSchema } from '@ai/schema';
import { ClaudeCodeDriver } from '@ai/drivers/claudeCode';
import { CodexDriver } from '@ai/drivers/codex';
import { GrokDriver } from '@ai/drivers/grok';
import { detectedProvider } from '@shared/aiDrivers';
import type { cliFailure } from '@ai/cli';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));
vi.mock('@ai/cli', async (original) => ({
  ...(await original<{ cliFailure: typeof cliFailure }>()),
  findExecutable: () => undefined,
}));
afterEach(() => vi.clearAllMocks());

it.each([
  ...[ClaudeCodeDriver, CodexDriver, GrokDriver].map((driver) => ({ driver, partial: false })),
  { driver: ClaudeCodeDriver, partial: true },
])(
  '$driver.kind exposes discovery over MCP (partial: $partial)',
  async ({ driver, partial }) => {
    spawn.mockImplementation((_command, args: string[], options) => {
      let url = '';
      let authorization = '';
      if (driver.kind === 'claudeCode') {
        const server = JSON.parse(args[args.indexOf('--mcp-config') + 1]!).mcpServers.shelf;
        url = server.url;
        authorization = server.headers.Authorization;
        expect(args.slice(args.indexOf('--allowedTools'))).toContain(
          'mcp__shelf__inspect_schema'
        );
      } else if (driver.kind === 'codex') {
        const config = args.filter((_, index) => args[index - 1] === '-c');
        url = JSON.parse(
          config.find((value) => value.startsWith('mcp_servers.shelf.url='))!.split('=')[1]!
        );
        authorization = `Bearer ${options.env.SHELF_MCP_TOKEN}`;
      }
      const send = (frame: unknown) => child.stdout.write(JSON.stringify(frame) + '\n');
      const rpc = async (method: string, params = {}) => {
        const response = await fetch(url, {
          method: 'POST',
          headers: { Authorization: authorization },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        });
        expect(response.status).toBe(200);
        return (await response.json()).result;
      };
      const read = async () => {
        const listing = await rpc('tools/list');
        expect(
          listing.tools.find((tool: { name: string }) => tool.name === 'inspect_schema')
            .inputSchema.properties
        ).toHaveProperty('search');
        const discovery = await rpc('tools/call', {
          name: 'inspect_schema',
          arguments: { tables: [], search: ['revenue_net_cents'] },
        });
        expect(
          JSON.parse(discovery.content[0].text).tables.some(
            (table: { name: string }) => table.name === 'daily_metrics'
          )
        ).toBe(true);
        const definition = await rpc('tools/call', {
          name: 'inspect_schema',
          arguments: { tables: ['ops.daily_metrics'] },
        });
        expect(definition.content[0].text).toContain('listeners_total');
        const query = await rpc('tools/call', {
          name: 'run_sql',
          arguments: { sql: 'SELECT region FROM ops.daily_metrics LIMIT 5', intent: 'answer' },
        });
        expect(JSON.parse(query.content[0].text).rows.length).toBeGreaterThan(0);
      };
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(),
        stdin: new Writable({
          write(chunk, _encoding, done) {
            const line = String(chunk);
            if (driver.kind === 'grok') {
              const frame = JSON.parse(line);
              if (frame.method === 'initialize')
                queueMicrotask(() => send({ id: frame.id, result: {} }));
              if (frame.method === 'session/new') {
                const server = frame.params.mcpServers[0];
                url = server.url;
                authorization = server.headers[0].value;
                queueMicrotask(() => send({ id: frame.id, result: { sessionId: 'session' } }));
              }
              if (frame.method === 'session/prompt')
                void read()
                  .then(() => {
                    send({
                      method: 'session/update',
                      params: {
                        update: {
                          sessionUpdate: 'agent_message_chunk',
                          content: { type: 'text', text: 'Found the rows.' },
                        },
                      },
                    });
                    send({ id: frame.id, result: { stopReason: 'end_turn' } });
                  })
                  .catch((error) => child.emit('error', error));
            } else
              void read()
                .then(() => {
                  if (partial)
                    send({
                      type: 'stream_event',
                      event: {
                        type: 'content_block_delta',
                        delta: { type: 'text_delta', text: 'Found the rows.' },
                      },
                    });
                  child.stdout.end(
                    JSON.stringify(
                      driver.kind === 'claudeCode'
                        ? { type: 'result', result: 'Found the rows.' }
                        : {
                            type: 'item.completed',
                            item: { type: 'agent_message', text: 'Found the rows.' },
                          }
                    ) + '\n'
                  );
                  child.emit('exit', 0);
                })
                .catch((error) => child.emit('error', error));
            done();
          },
        }),
      });
      return child;
    });
    const client = new MockClient({ engine: 'mock' });
    await client.connect();
    try {
      const result = await runTurn(
        {
          adapter: driver.create(detectedProvider(driver.kind), undefined),
          client,
          document: await gatherSchema(
            client,
            { kind: 'entity', entity: { schema: 'music', name: 'album' } },
            { budget: 24000 }
          ),
          model: 'default',
          maxTokens: 1000,
          history: [],
          question: 'Find the revenue data.',
        },
        { item: () => undefined, delta: () => undefined, replace: () => undefined },
        new AbortController().signal
      );
      expect(
        result.items.filter((item) => item.kind === 'step' && item.state === 'done')
      ).toHaveLength(3);
      expect(
        result.items
          .filter((item) => item.kind === 'text')
          .map((item) => item.text)
          .join('')
      ).toBe('Found the rows.');
    } finally {
      await client.disconnect();
    }
  }
);
