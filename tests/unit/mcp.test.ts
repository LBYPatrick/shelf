import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startToolBridge, type ToolBridge } from '@ai/mcp';
import type { AiToolCall, AiToolDef } from '@ai/types';

const tools: AiToolDef[] = [
  { name: 'run_sql', description: 'Read rows', schema: { type: 'object', properties: {} } },
];

describe('the shared MCP bridge', () => {
  let bridge: ToolBridge;
  const execute = vi.fn(async (call: AiToolCall) => ({ ...call, content: '42' }));

  beforeEach(async () => {
    execute.mockClear();
    bridge = await startToolBridge(tools, execute);
  });
  afterEach(async () => bridge.close());

  function post(message: unknown, token = bridge.token) {
    return fetch(bridge.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(message),
    });
  }

  it('initializes, lists read-only tools and executes a call', async () => {
    const initialized = await post({ jsonrpc: '2.0', id: 0, method: 'initialize' });
    expect(await initialized.json()).toMatchObject({
      id: 0,
      result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } },
    });
    const notification = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(notification.status).toBe(202);
    expect(await notification.text()).toBe('');
    const listing = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(await listing.json()).toMatchObject({
      result: {
        tools: [
          { name: 'run_sql', annotations: { readOnlyHint: true, destructiveHint: false } },
        ],
      },
    });
    const result = await post({
      jsonrpc: '2.0',
      id: 'call',
      method: 'tools/call',
      params: { name: 'run_sql', arguments: { sql: 'SELECT 42' } },
    });
    expect(await result.json()).toEqual({
      jsonrpc: '2.0',
      id: 'call',
      result: { content: [{ type: 'text', text: '42' }] },
    });
    expect(execute).toHaveBeenCalledWith({
      id: 'mcp-call',
      name: 'run_sql',
      input: { sql: 'SELECT 42' },
    });
  });

  it('responds to client health checks', async () => {
    const result = await post({ jsonrpc: '2.0', id: 0, method: 'ping' });
    expect(await result.json()).toEqual({ jsonrpc: '2.0', id: 0, result: {} });
  });

  it.each(['GET', 'DELETE'])(
    'rejects unsupported %s without malformed JSON-RPC',
    async (method) => {
      const result = await fetch(bridge.url, {
        method,
        headers: { Authorization: `Bearer ${bridge.token}` },
      });
      expect(result.status).toBe(405);
      expect(result.headers.get('allow')).toBe('POST');
      expect(await result.text()).toBe('');
    }
  );

  it('rejects another process without executing its call', async () => {
    const result = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call' }, 'wrong');
    expect(result.status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it('carries executor refusals as tool errors', async () => {
    execute.mockRejectedValueOnce(new Error('Only read-only statements are allowed.'));
    const result = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'run_sql' },
    });
    expect(await result.json()).toMatchObject({
      result: {
        isError: true,
        content: [{ type: 'text', text: 'Only read-only statements are allowed.' }],
      },
    });
  });
});
