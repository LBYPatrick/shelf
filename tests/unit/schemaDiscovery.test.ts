import { describe, expect, it, vi } from 'vitest';
import { MockClient } from '@drivers/mock';
import { discoverSchema, gatherSchema } from '@ai/schema';
import { SchemaCache } from '@ai/schemaCache';
import { runTurn } from '@ai/agent';
import type { AiAdapter, AiRequest } from '@ai/types';
import type { Column, Entity } from '@drivers/types';

function fixture() {
  const client = new MockClient({ engine: 'mock' });
  const entities: Entity[] = [
    { schema: 'analytics', name: 'episode_fact', kind: 'table' },
    { schema: 'operations', name: 'capture_records', kind: 'table' },
    { schema: 'operations', name: 'template_catalog', kind: 'table' },
  ];
  const column = (name: string, dataType = 'boolean'): Column => ({
    name,
    dataType,
    ordinal: 0,
    nullable: false,
  });
  vi.spyOn(client, 'listEntities').mockImplementation(async (schema) =>
    entities.filter((entity) => !schema || entity.schema === schema)
  );
  const columns = vi
    .spyOn(client, 'listColumns')
    .mockImplementation(async (entity) =>
      entity.name === 'capture_records'
        ? [column('metadata_info', 'jsonb'), column('has_fail')]
        : entity.name === 'template_catalog'
          ? [column('template_type', 'text')]
          : [column('is_valid')]
    );
  vi.spyOn(client, 'listIndexes').mockResolvedValue([]);
  vi.spyOn(client, 'listRelations').mockResolvedValue([]);
  return { client, columns, entities };
}

describe('schema discovery from a selected table', () => {
  it('lists the whole connection without reading every column', async () => {
    const { client, columns } = fixture();
    const catalog = await discoverSchema(client, []);
    expect(catalog.tables.map((table) => `${table.schema}.${table.name}`)).toEqual([
      'analytics.episode_fact',
      'operations.capture_records',
      'operations.template_catalog',
    ]);
    expect(columns).not.toHaveBeenCalled();
  });

  it('finds missing columns across schemas and reuses cached reads', async () => {
    const { client, columns } = fixture();
    const cache = new SchemaCache();
    const initial = await gatherSchema(
      client,
      { kind: 'entity', entity: { schema: 'analytics', name: 'episode_fact' } },
      { budget: 24000, cache }
    );
    expect(initial.tables).toHaveLength(1);
    const found = await discoverSchema(
      client,
      ['has_fail', 'metadata info', 'task template'],
      cache
    );
    expect(found.tables.map((table) => table.name)).toEqual(['capture_records']);
    expect(found.tables[0]!.columns.map((column) => column.name)).toContain('metadata_info');
    await discoverSchema(client, ['template type'], cache);
    expect(columns).toHaveBeenCalledTimes(3);
  });

  it('reports unreadable metadata instead of claiming a column is absent', async () => {
    const { client, columns } = fixture();
    columns.mockRejectedValue(new Error('permission denied'));
    const found = await discoverSchema(client, ['has_fail']);
    expect(found.tables).toHaveLength(0);
    expect(found.omissions!.join(' ')).toContain('cannot be ruled out');
    expect(found.omissions!.join(' ')).toContain('operations.capture_records');
  });

  it('stops discovery when the turn is cancelled', async () => {
    const { client, columns } = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      discoverSchema(client, ['has_fail'], undefined, controller.signal)
    ).rejects.toThrow();
    expect(columns).not.toHaveBeenCalled();
  });

  it('keeps name-only tables beyond the initial column-read budget', async () => {
    const { client, columns } = fixture();
    vi.mocked(client.listEntities).mockResolvedValue(
      Array.from({ length: 125 }, (_, index) => ({ name: `table_${index}`, kind: 'table' }))
    );
    const document = await gatherSchema(client, { kind: 'connection' }, { budget: 1000000 });
    expect(document.tables).toHaveLength(125);
    expect(document.tables[124]!.columns).toEqual([]);
    expect(columns).toHaveBeenCalledTimes(120);
  });

  it('serves discovery through the same executor used by CLI MCP adapters', async () => {
    const { client } = fixture();
    const document = await gatherSchema(
      client,
      { kind: 'entity', entity: { schema: 'analytics', name: 'episode_fact' } },
      { budget: 24000 }
    );
    let result = '';
    const adapter: AiAdapter = {
      kind: 'codex',
      capabilities: { streaming: true, tools: true, system: false },
      async send(request: AiRequest) {
        result = (
          await request.execute!({
            id: 'discovery',
            name: 'inspect_schema',
            input: { tables: [], search: ['has_fail', 'metadata_info'] },
          })
        ).content;
        return { text: 'Found it.', calls: [], stop: 'end' };
      },
    };
    const outcome = await runTurn(
      {
        adapter,
        client,
        document,
        model: 'default',
        maxTokens: 1000,
        history: [],
        question: 'Find metadata_info and has_fail.',
      },
      { item: () => undefined, delta: () => undefined, replace: () => undefined },
      new AbortController().signal
    );
    expect(result).toContain('capture_records');
    expect(result).toContain('metadata_info');
    expect(
      outcome.items.some(
        (item) =>
          item.kind === 'step' && item.tool === 'inspect_schema' && item.state === 'done'
      )
    ).toBe(true);
  });
});
