import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { GrokDriver, permissionOutcome } from '@ai/drivers/grok';
import { detectedProvider } from '@shared/aiDrivers';
import { TOOLS } from '@ai/agent';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));
afterEach(() => vi.clearAllMocks());

it('answers a permission request with a colliding ID, executes the bridge tool, then resumes', async () => {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  spawn.mockReturnValue(child);
  let bridge: { url: string; headers: { name: string; value: string }[] };
  let promptId: number;
  const requests: Promise<void>[] = [];
  const emit = (frame: unknown) => child.stdout.write(`${JSON.stringify(frame)}\n`);
  child.stdin.on('data', (chunk) => {
    requests.push(
      (async () => {
        const frame = JSON.parse(chunk.toString());
        if (frame.method === 'initialize')
          emit({ id: frame.id, result: { protocolVersion: 1 } });
        if (frame.method === 'session/new') {
          bridge = frame.params.mcpServers[0];
          emit({ id: frame.id, result: { sessionId: 's' } });
        }
        if (frame.method === 'session/prompt') {
          promptId = frame.id;
          emit({
            method: 'session/update',
            params: {
              update: {
                sessionUpdate: 'tool_call',
                toolCallId: 'q',
                name: 'mcp__shelf__run_sql',
                title: 'Read albums',
              },
            },
          });
          emit({
            id: promptId,
            method: 'session/request_permission',
            params: {
              toolCall: { toolCallId: 'q' },
              options: [
                { kind: 'allow_once', optionId: 'yes' },
                { kind: 'reject_once', optionId: 'no' },
              ],
            },
          });
        }
        if (frame.result?.outcome) {
          expect(frame.result.outcome).toEqual({ outcome: 'selected', optionId: 'yes' });
          const response = await fetch(bridge.url, {
            method: 'POST',
            headers: Object.fromEntries(bridge.headers.map(({ name, value }) => [name, value])),
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: { name: 'run_sql', arguments: { sql: 'SELECT 1' } },
            }),
          });
          expect(await response.json()).toMatchObject({
            result: { content: [{ type: 'text', text: 'one row' }] },
          });
          emit({
            method: 'session/update',
            params: {
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: 'One row.' },
              },
            },
          });
          emit({ id: promptId, result: { stopReason: 'end_turn' } });
        }
      })()
    );
  });
  const execute = vi.fn(async (call) => ({ id: call.id, name: call.name, content: 'one row' }));
  const reply = await GrokDriver.create(detectedProvider('grok'), undefined).send(
    {
      model: 'default',
      system: 'Read only',
      messages: [{ role: 'user', text: 'Count' }],
      tools: TOOLS,
      execute,
      maxTokens: 100,
    },
    { text: () => undefined, thinking: () => undefined },
    new AbortController().signal
  );
  await Promise.all(requests);
  expect(execute).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ name: 'run_sql', input: { sql: 'SELECT 1' } })
  );
  expect(reply.text).toBe('One row.');
  expect(child.kill).toHaveBeenCalled();
});

it.each(['Bash', 'mcp__other__run_sql', 'run_sql', undefined])(
  'rejects an unrelated or unidentified tool: %s',
  (name) => {
    expect(
      permissionOutcome(
        {
          toolCall: { name },
          options: [
            { kind: 'allow_once', optionId: 'yes' },
            { kind: 'reject_once', optionId: 'no' },
          ],
        },
        ['mcp__shelf__run_sql']
      )
    ).toEqual({ outcome: 'selected', optionId: 'no' });
  }
);

it('does not grant permanent approval or approve without a bridge', () => {
  expect(
    permissionOutcome(
      {
        toolCall: { name: 'mcp__shelf__run_sql' },
        options: [{ kind: 'allow_always', optionId: 'always' }],
      },
      ['mcp__shelf__run_sql']
    )
  ).toEqual({ outcome: 'cancelled' });
  expect(
    permissionOutcome(
      {
        toolCall: { name: 'mcp__shelf__run_sql' },
        options: [{ kind: 'allow_once', optionId: 'yes' }],
      },
      []
    )
  ).toEqual({ outcome: 'cancelled' });
});

it('Codex explicitly approves only the supplied tools', async () => {
  const { CodexDriver } = await import('@ai/drivers/codex');
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  spawn.mockReturnValue(child);
  child.stdin.on('finish', () => {
    child.stdout.end(
      `${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Done' } })}\n`
    );
    child.emit('exit', 0);
  });
  const adapter = CodexDriver.create(detectedProvider('codex'), undefined);
  const reply = await adapter.send(
    {
      model: 'default',
      system: 'Read',
      messages: [{ role: 'user', text: 'Count' }],
      tools: TOOLS,
      maxTokens: 100,
      execute: async (call) => ({ id: call.id, name: call.name, content: 'result' }),
    },
    { text: () => undefined, thinking: () => undefined },
    new AbortController().signal
  );
  const args = spawn.mock.calls[0]![1] as string[];
  expect(args).toContain('read-only');
  expect(args).toContain('mcp_servers.shelf.required=true');
  expect(args).toContain('mcp_servers.shelf.default_tools_approval_mode="approve"');
  expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  expect(reply.text).toBe('Done');
});
