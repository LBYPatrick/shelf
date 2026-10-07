import { expect, it } from 'vitest';
import { MockClient } from '@drivers/mock';
import { runTurn } from '@ai/agent';
import { CodexDriver, COMMAND, CANDIDATES } from '@ai/drivers/codex';
import { findExecutable } from '@ai/cli';
import { gatherSchema } from '@ai/schema';
import { detectedProvider } from '@shared/aiDrivers';

it.skipIf(!findExecutable(COMMAND, CANDIDATES))(
  'Codex inspects and queries through Shelf MCP before answering',
  { timeout: 180_000 },
  async () => {
    const client = new MockClient({ engine: 'mock' });
    await client.connect();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 170_000);
    try {
      const document = await gatherSchema(client, { kind: 'connection' }, { budget: 24_000 });
      const result = await runTurn(
        {
          adapter: CodexDriver.create(detectedProvider('codex'), undefined),
          client,
          document,
          model: 'default',
          maxTokens: 8_000,
          history: [],
          question:
            'Inspect the album table with inspect_schema, then count its rows with run_sql. Report the result. Use the Shelf tools, not shell commands.',
        },
        { item: () => undefined, delta: () => undefined, replace: () => undefined },
        controller.signal
      );
      expect(
        result.items.some(
          (item) =>
            item.kind === 'step' && item.tool === 'inspect_schema' && item.state === 'done'
        ),
        JSON.stringify(result.items)
      ).toBe(true);
      expect(
        result.items.some(
          (item) => item.kind === 'step' && item.rows && item.rows.rows.length > 0
        ),
        JSON.stringify(result.items)
      ).toBe(true);
      expect(
        result.items.some((item) => item.kind === 'text' && item.text.length > 0),
        JSON.stringify(result.items)
      ).toBe(true);
    } finally {
      clearTimeout(timer);
      await client.disconnect();
    }
  }
);
