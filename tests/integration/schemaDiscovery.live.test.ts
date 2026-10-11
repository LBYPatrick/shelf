import { expect, it } from 'vitest';
import { MockClient } from '@drivers/mock';
import { runTurn } from '@ai/agent';
import { CodexDriver, COMMAND as CODEX, CANDIDATES as CODEX_PATHS } from '@ai/drivers/codex';
import {
  ClaudeCodeDriver,
  COMMAND as CLAUDE,
  CANDIDATES as CLAUDE_PATHS,
} from '@ai/drivers/claudeCode';
import { GrokDriver, COMMAND as GROK, CANDIDATES as GROK_PATHS } from '@ai/drivers/grok';
import { findExecutable } from '@ai/cli';
import { signInState } from '@ai/installed';
import { gatherSchema } from '@ai/schema';
import { detectedProvider } from '@shared/aiDrivers';

for (const [driver, command, paths] of [
  [ClaudeCodeDriver, CLAUDE, CLAUDE_PATHS],
  [CodexDriver, CODEX, CODEX_PATHS],
  [GrokDriver, GROK, GROK_PATHS],
] as const) {
  const available =
    !!findExecutable(command, paths) && (await signInState(driver.kind)) !== 'out';
  it.skipIf(!available)(
    `${driver.kind} discovers unprovided fields without being told to use tools`,
    { timeout: 180000 },
    async () => {
      const client = new MockClient({ engine: 'mock' });
      await client.connect();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 170000);
      try {
        const document = await gatherSchema(
          client,
          { kind: 'entity', entity: { schema: 'music', name: 'album' } },
          { budget: 24000 }
        );
        expect(document.tables.every((table) => table.schema === 'music')).toBe(true);
        const result = await runTurn(
          {
            adapter: driver.create(detectedProvider(driver.kind), undefined),
            client,
            document,
            model: 'default',
            maxTokens: 8000,
            history: [
              {
                role: 'user',
                text: '给我 revenue_net_cents 最高的五条记录，同时显示 region 和 listeners_total。',
              },
              {
                role: 'assistant',
                text: '请提供表名和列结构。当前展示的 music.album 没有这些字段，不能安全推断关联表。',
              },
            ],
            question:
              '给我 revenue_net_cents 最高的五条记录，同时显示 region 和 listeners_total。请查询当前数据库并给出结果。',
            locale: 'zh-CN',
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
            (item) =>
              item.kind === 'step' &&
              item.tool === 'run_sql' &&
              item.state === 'done' &&
              item.sql?.includes('daily_metrics') &&
              item.rows!.rows.length > 0
          ),
          JSON.stringify(result.items)
        ).toBe(true);
        expect(
          result.items
            .filter((item) => item.kind === 'text')
            .map((item) => item.text)
            .join(' ')
        ).not.toMatch(/请提供.*(?:表名|列结构)/);
      } finally {
        clearTimeout(timer);
        await client.disconnect();
      }
    }
  );
}
