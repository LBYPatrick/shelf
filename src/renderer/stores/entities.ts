import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Column, Entity, EntityKind, EntityRef } from '@drivers/types';
import { host } from '../lib/host';
import { useConnections } from './connections';

/** A flattened row in the sidebar tree, ready to be virtualised. */
export interface TreeRow {
  readonly key: string;
  readonly kind: 'schema' | 'entity' | 'column' | 'loading' | 'empty';
  readonly depth: number;
  readonly label: string;
  readonly detail?: string;
  readonly entity?: Entity;
  readonly expanded?: boolean;
  readonly entityKind?: EntityKind;
}

export function entityKey(entity: EntityRef): string {
  return entity.schema ? `${entity.schema}.${entity.name}` : entity.name;
}

/**
 * The database's structure, as the sidebar shows it.
 *
 * The tree is kept as a *flat* list of visible rows rather than a nested
 * structure, because a schema with fifty thousand tables has to be virtualised,
 * and virtualising a flat list is straightforward where virtualising a nested
 * one is not.
 */
export const useEntities = defineStore('entities', () => {
  const connections = useConnections();

  const schemas = ref<string[]>([]);
  const entities = ref<Entity[]>([]);
  const columns = ref<Map<string, Column[]>>(new Map());
  const loadingColumns = ref<Set<string>>(new Set());
  const expanded = ref<Set<string>>(new Set());
  const loading = ref(false);
  const error = ref<string | null>(null);

  const filter = ref('');
  const showTables = ref(true);
  const showViews = ref(true);
  const showRoutines = ref(true);

  function connectionId(): string {
    const id = connections.active?.id;
    if (!id) throw new Error('No open connection');
    return id;
  }

  async function refresh(): Promise<void> {
    if (!connections.active) return;

    loading.value = true;
    error.value = null;

    try {
      const id = connectionId();
      const [schemaList, entityList] = await Promise.all([
        connections.active.capabilities.schemas
          ? host.call('schema/schemas', { connectionId: id })
          : Promise.resolve([] as readonly string[]),
        host.call('schema/entities', { connectionId: id }),
      ]);

      schemas.value = [...schemaList];
      entities.value = [...entityList];
      columns.value = new Map();
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught);
    } finally {
      loading.value = false;
    }
  }

  async function loadColumns(entity: Entity): Promise<void> {
    const key = entityKey(entity);
    if (columns.value.has(key) || loadingColumns.value.has(key)) return;

    loadingColumns.value = new Set(loadingColumns.value).add(key);
    try {
      const result = await host.call('schema/columns', {
        connectionId: connectionId(),
        entity: { name: entity.name, ...(entity.schema ? { schema: entity.schema } : {}) },
      });
      columns.value = new Map(columns.value).set(key, [...result]);
    } catch {
      // A table we cannot introspect still lists; the expansion simply shows
      // nothing rather than breaking the sidebar.
      columns.value = new Map(columns.value).set(key, []);
    } finally {
      const next = new Set(loadingColumns.value);
      next.delete(key);
      loadingColumns.value = next;
    }
  }

  function toggle(entity: Entity): void {
    const key = entityKey(entity);
    const next = new Set(expanded.value);

    if (next.has(key)) next.delete(key);
    else {
      next.add(key);
      void loadColumns(entity);
    }

    expanded.value = next;
  }

  function collapseAll(): void {
    expanded.value = new Set();
  }

  const visibleEntities = computed(() => {
    const needle = filter.value.trim().toLowerCase();

    return entities.value.filter((entity) => {
      if (entity.kind === 'routine' && !showRoutines.value) return false;
      if ((entity.kind === 'view' || entity.kind === 'materialized-view') && !showViews.value) {
        return false;
      }
      if ((entity.kind === 'table' || entity.kind === 'collection') && !showTables.value) {
        return false;
      }
      return needle === '' || entity.name.toLowerCase().includes(needle);
    });
  });

  const hiddenCount = computed(() => entities.value.length - visibleEntities.value.length);

  /**
   * Grouping by schema is suppressed when there is only one, because a tree
   * with a single root that everything hangs from is a wasted level of
   * indentation.
   */
  const rows = computed<TreeRow[]>(() => {
    const grouped = new Map<string, Entity[]>();
    for (const entity of visibleEntities.value) {
      const schema = entity.schema ?? '';
      const list = grouped.get(schema);
      if (list) list.push(entity);
      else grouped.set(schema, [entity]);
    }

    const useGroups = grouped.size > 1;
    const result: TreeRow[] = [];

    for (const [schema, list] of [...grouped.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      if (useGroups) {
        result.push({
          key: `schema:${schema}`,
          kind: 'schema',
          depth: 0,
          label: schema || 'default',
          detail: String(list.length),
        });
      }

      for (const entity of list) {
        const key = entityKey(entity);
        const isExpanded = expanded.value.has(key);

        result.push({
          key: `entity:${key}`,
          kind: 'entity',
          depth: useGroups ? 1 : 0,
          label: entity.name,
          entity,
          entityKind: entity.kind,
          expanded: isExpanded,
        });

        if (!isExpanded) continue;

        const entityColumns = columns.value.get(key);
        if (!entityColumns) {
          result.push({
            key: `loading:${key}`,
            kind: 'loading',
            depth: (useGroups ? 1 : 0) + 1,
            label: 'Loading columns…',
          });
          continue;
        }

        if (entityColumns.length === 0) {
          result.push({
            key: `empty:${key}`,
            kind: 'empty',
            depth: (useGroups ? 1 : 0) + 1,
            label: 'No columns',
          });
          continue;
        }

        for (const column of entityColumns) {
          result.push({
            key: `column:${key}.${column.name}`,
            kind: 'column',
            depth: (useGroups ? 1 : 0) + 1,
            label: column.name,
            detail: column.dataType,
          });
        }
      }
    }

    return result;
  });

  function reset(): void {
    schemas.value = [];
    entities.value = [];
    columns.value = new Map();
    expanded.value = new Set();
    filter.value = '';
    error.value = null;
  }

  return {
    schemas,
    entities,
    columns,
    expanded,
    loading,
    error,
    filter,
    showTables,
    showViews,
    showRoutines,
    visibleEntities,
    hiddenCount,
    rows,
    refresh,
    loadColumns,
    toggle,
    collapseAll,
    reset,
  };
});
