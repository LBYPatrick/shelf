import { expect, it, vi } from 'vitest';
import { startToolBridge } from '@ai/mcp';
import { TOOLS } from '@ai/agent';

it('advertises read-only tools and requires the per-turn bearer token', async () => {
  const execute = vi.fn();
  const bridge = await startToolBridge(TOOLS, execute);
  try {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const unauthorized = await fetch(bridge.url, { method: 'POST', body });
    expect(unauthorized.status).toBe(401);
    const response = await fetch(bridge.url, {
      method: 'POST',
      body,
      headers: { authorization: `Bearer ${bridge.token}` },
    });
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        tools: TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.schema,
          annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        })),
      },
    });
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await bridge.close();
  }
  await expect(fetch(bridge.url)).rejects.toThrow();
});
