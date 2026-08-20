<script setup lang="ts">
/**
 * The schema as a diagram.
 *
 * Columns and relations are loaded for every table at once, which is the whole
 * point — a diagram of one table is a list. Requests are made in parallel and
 * bounded, so a schema with hundreds of tables does not open hundreds of
 * simultaneous round trips.
 */
import { computed, onMounted, ref } from 'vue';
import { host } from '../../lib/host';
import { useConnections } from '../../stores/connections';
import { useEntities } from '../../stores/entities';
import { useTabs } from '../../stores/tabs';
import ErdCanvas, { type ErdEdge, type ErdTable } from '../viz/ErdCanvas.vue';
import { errorMessage } from '@shared/errors';

const props = defineProps<{
  active: boolean;
  scope: { readonly kind: 'database' | 'schema'; readonly name: string } | null;
}>();

const connections = useConnections();
const entities = useEntities();
const tabs = useTabs();

const tables = ref<ErdTable[]>([]);
const edges = ref<ErdEdge[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

/** Concurrent metadata requests. Enough to be quick, few enough to be polite. */
const CONCURRENCY = 6;

async function inBatches<T, R>(
  items: readonly T[],
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += CONCURRENCY) {
    results.push(...(await Promise.all(items.slice(index, index + CONCURRENCY).map(worker))));
  }
  return results;
}

function keyOf(entity: { name: string; schema?: string }): string {
  return entity.schema ? `${entity.schema}.${entity.name}` : entity.name;
}

async function load(): Promise<void> {
  const connectionId = connections.active?.id;
  if (!connectionId) return;

  loading.value = true;
  error.value = null;

  try {
    /*
     * Only what the diagram is of. A schema draws its own tables; a database
     * draws all of them, which is what it means to ask for the database.
     */
    const targets = entities.entities.filter(
      (entity) =>
        (entity.kind === 'table' || entity.kind === 'collection') &&
        (props.scope?.kind !== 'schema' || entity.schema === props.scope.name)
    );

    const loaded = await inBatches(targets, async (entity) => {
      const ref_ = { name: entity.name, ...(entity.schema ? { schema: entity.schema } : {}) };

      const [columns, relations] = await Promise.all([
        host.call('schema/columns', { connectionId, entity: ref_ }),
        connections.active?.capabilities.relations
          ? host.call('schema/relations', { connectionId, entity: ref_ })
          : Promise.resolve([]),
      ]);

      return { entity, ref: ref_, columns, relations };
    });

    tables.value = loaded.map(({ entity, columns }) => ({
      key: keyOf(entity),
      name: entity.name,
      ...(entity.schema ? { schema: entity.schema } : {}),
      columns: columns.map((column) => ({
        name: column.name,
        dataType: column.dataType,
        primaryKey: column.primaryKey,
      })),
    }));

    // Only outgoing keys are collected: taking both directions would draw every
    // relationship twice.
    const seen = new Set<string>();
    const collected: ErdEdge[] = [];

    for (const { entity, relations } of loaded) {
      for (const relation of relations) {
        if (relation.direction !== 'outgoing') continue;

        const source = keyOf(entity);
        const target = keyOf(relation.referencedTable);
        const id = `${source}->${target}:${relation.columns.join(',')}`;
        if (seen.has(id)) continue;

        seen.add(id);
        collected.push({ source, target, label: relation.columns.join(', ') });
      }
    }

    edges.value = collected;
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    loading.value = false;
  }
}

function openTable(key: string): void {
  const entity = entities.entities.find((candidate) => keyOf(candidate) === key);
  if (!entity) return;
  tabs.openEntity('table', {
    name: entity.name,
    ...(entity.schema ? { schema: entity.schema } : {}),
  });
}

const summary = computed(
  () => `${tables.value.length} tables · ${edges.value.length} relationships`
);

onMounted(load);
</script>

<template>
  <div class="erd-tab">
    <p
      v-if="error"
      class="erd-tab__note erd-tab__note--error"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-else-if="loading"
      class="erd-tab__note"
    >
      Reading the schema…
    </p>
    <p
      v-else-if="tables.length === 0"
      class="erd-tab__note"
    >
      There is nothing to diagram yet.
    </p>

    <ErdCanvas
      v-else
      :tables="tables"
      :edges="edges"
      @open-table="openTable"
    />

    <Teleport
      v-if="active && !loading"
      to="#statusbar-slot"
      defer
    >
      <span class="tabstatus__item">{{ summary }}</span>
    </Teleport>
  </div>
</template>

<style scoped>
.erd-tab {
  height: 100%;
  min-height: 0;
}

.erd-tab__note {
  display: grid;
  place-content: center;
  height: 100%;
  font-size: 0.75rem;
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
}

.erd-tab__note--error {
  color: var(--color-error);
}
</style>
