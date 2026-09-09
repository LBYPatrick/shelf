import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexDriver } from '@ai/drivers/codex';
import { GrokDriver } from '@ai/drivers/grok';
import type { cliFailure } from '@ai/cli';
import type { AiRequest } from '@ai/types';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));
vi.mock('@ai/cli', async (original) => ({
  ...(await original<{ cliFailure: typeof cliFailure }>()),
  findExecutable: () => undefined,
}));

afterEach(() => vi.clearAllMocks());

function childProcess(onInput: (line: string) => void) {
  return Object.assign(new EventEmitter(), {
    stdin: new Writable({
      write(chunk, _encoding, done) {
        onInput(String(chunk));
        done();
      },
    }),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
}

const request: AiRequest = {
  model: 'default',
  system: 'Read the database.',
  messages: [{ role: 'user', text: 'Read rows' }],
  tools: [
    { name: 'run_sql', description: 'Read rows', schema: { type: 'object', properties: {} } },
  ],
  maxTokens: 100,
};
const sink = { text: vi.fn(), thinking: vi.fn() };

describe('CLI tool bridges', () => {
  it('gives Codex scoped approval and serves its tool call', async () => {
    let url = '';
    const execute = vi.fn(async (call) => ({ ...call, content: '42' }));
    spawn.mockImplementation((_command, args: string[], options) => {
      const config = args.filter((_, index) => args[index - 1] === '-c');
      expect(config).toContain('mcp_servers.shelf.default_tools_approval_mode="approve"');
      expect(config).toContain('mcp_servers.shelf.required=true');
      expect(args).toContain('read-only');
      url = JSON.parse(
        config.find((value) => value.startsWith('mcp_servers.shelf.url='))!.split('=')[1]
      );
      const child = childProcess(() => {
        void (async () => {
          const result = await fetch(url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${options.env.SHELF_MCP_TOKEN}` },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: { name: 'run_sql', arguments: { sql: 'SELECT 42' } },
            }),
          });
          const body = await result.json();
          child.stdout.end(
            JSON.stringify({
              type: 'item.completed',
              item: { type: 'agent_message', text: body.result.content[0].text },
            }) + '\n'
          );
          child.emit('exit', 0);
        })();
      });
      return child;
    });
    const adapter = CodexDriver.create(
      { id: 'test', name: 'Codex', driver: 'codex', model: 'default', createdAt: 0 },
      undefined
    );
    const reply = await adapter.send(
      { ...request, execute },
      sink,
      new AbortController().signal
    );
    expect(reply.text).toBe('42');
    expect(execute).toHaveBeenCalledOnce();
    await expect(fetch(url)).rejects.toThrow();
  });

  it('answers Grok permissions independently of colliding client request IDs', async () => {
    const outcomes: unknown[] = [];
    spawn.mockImplementation(() => {
      const child = childProcess((line) => {
        const frame = JSON.parse(line);
        const send = (value: unknown) => child.stdout.write(JSON.stringify(value) + '\n');
        queueMicrotask(() => {
          if (frame.method === 'initialize') send({ id: frame.id, result: {} });
          else if (frame.method === 'session/new')
            send({ id: frame.id, result: { sessionId: 'session' } });
          else if (frame.method === 'session/prompt') {
            send({
              method: 'session/update',
              params: {
                update: {
                  sessionUpdate: 'tool_call',
                  toolCallId: 'tool',
                  title: 'shelf__run_sql',
                },
              },
            });
            send({
              id: frame.id,
              method: 'session/request_permission',
              params: {
                toolCall: { toolCallId: 'tool' },
                options: [{ kind: 'allow_once', optionId: 'allow' }],
              },
            });
          } else if (frame.result) {
            outcomes.push(frame.result.outcome);
            send({ id: frame.id, result: { stopReason: 'end_turn' } });
          }
        });
      });
      return child;
    });
    const adapter = GrokDriver.create(
      { id: 'test', name: 'Grok', driver: 'grok', model: 'default', createdAt: 0 },
      undefined
    );
    await adapter.send(
      { ...request, execute: async (call) => ({ ...call, content: '42' }) },
      sink,
      new AbortController().signal
    );
    expect(outcomes).toEqual([{ outcome: 'selected', optionId: 'allow' }]);
  });
});
