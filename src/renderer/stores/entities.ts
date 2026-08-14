import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Column, Entity, EntityKind, EntityRef } from '@drivers/types';
import { host } from '../lib/host';
import { useConnections } from './connections';
import { errorMessage } from '@shared/errors';

/** A flattened row in the sidebar tree, ready to be virtualised. */
export interface TreeRow {
  readonly key: string;
  readonly kind: 'database' | 'schema' | 'entity' | 'column' | 'loading' | 'empty';
  readonly depth: number;
  readonly label: string;
  readonly detail?: string;
  readonly entity?: Entity;
  readonly expanded?: boolean;
  readonly entityKind?: EntityKind;
  /** Set on anything that opens, so the row can be toggled without knowing what it is. */
  readonly groupKey?: string;
}

export function entityKey(entity: EntityRef): string {
  return entity.schema ? `${entity.schema}.${entity.name}` : entity.name;
}

/**
 * Keys are prefixed by what they name.
 *
 * A database and a schema can share a name — on MySQL they are the same word —
 * and without the prefix collapsing one would collapse the other.
 */
const databaseKey = (name: string) => `db:${name}`;
const schemaKey = (name: string) => `schema:${name}`;

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
  /*
   * Two sets, because the two kinds of folder want opposite defaults.
   *
   * Schemas and tables are opt-in: there can be hundreds, and opening a table
   * costs a round trip for its columns. The database is opt-out — there is
   * exactly one, and a tree whose single root is shut shows you nothing at all.
   */
  const expanded = ref<Set<string>>(new Set());
  const collapsedDatabases = ref<Set<string>>(new Set());
  const loading = ref(false);
  const error = ref<string | null>(null);

  const filter = ref('');
  const showTables = ref(true);
  const showViews = ref(true);
  const showRoutines = ref(true);

  async function refresh(): Promise<void> {
    if (!connections.active) return;

    loading.value = true;
    error.value = null;

    try {
      const id = connections.requireId();
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
      error.value = errorMessage(caught);
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
        connectionId: connections.requireId(),
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

  /** Opens or closes a database or schema folder. */
  function toggleGroup(key: string): void {
    if (key.startsWith('db:')) {
      const next = new Set(collapsedDatabases.value);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      collapsedDatabases.value = next;
      return;
    }

    const next = new Set(expanded.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expanded.value = next;
  }

  /**
   * Shuts every folder except the one they all hang from.
   *
   * Collapsing the database as well is literal and useless: the sidebar empties
   * to a single row, the button then does nothing, and getting back requires
   * finding the one thing left on screen. "All" means all the folders you were
   * looking through, not the container you were looking in.
   */
  function collapseAll(): void {
    expanded.value = new Set();
    collapsedDatabases.value = new Set();
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
   * The tree, flattened to the rows that are actually visible.
   *
   * Three levels of folder — database, schema, table — and the columns inside a
   * table below that. Folders are shut until opened, with one exception: a
   * level holding exactly one thing opens itself, because a folder you must
   * click to reveal its only child is a click that tells you nothing. That is
   * also why a lone schema disappears rather than being drawn as a branch with
   * everything hanging off it.
   *
   * A filter opens what it matched. Typing a table name and being shown a list
   * of shut folders that contain it is a search that has answered the question
   * and then hidden the answer.
   */
  const rows = computed<TreeRow[]>(() => {
    const grouped = new Map<string, Entity[]>();
    for (const entity of visibleEntities.value) {
      const schema = entity.schema ?? '';
      const list = grouped.get(schema);
      if (list) list.push(entity);
      else grouped.set(schema, [entity]);
    }

    const filtering = filter.value.trim() !== '';
    const useSchemas = grouped.size > 1;

    const database = connections.active?.database ?? null;
    const dbKey = database ? databaseKey(database) : null;
    const dbOpen = !dbKey || filtering || !collapsedDatabases.value.has(dbKey);

    const result: TreeRow[] = [];

    if (database && dbKey) {
      result.push({
        key: dbKey,
        kind: 'database',
        depth: 0,
        label: database,
        detail: String(visibleEntities.value.length),
        expanded: dbOpen,
        groupKey: dbKey,
      });
    }

    if (!dbOpen) return result;

    const base = database ? 1 : 0;

    const appendEntities = (list: readonly Entity[], depth: number): void => {
      for (const entity of list) {
        const key = entityKey(entity);
        const isExpanded = expanded.value.has(key);

        result.push({
          key: `entity:${key}`,
          kind: 'entity',
          depth,
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
            depth: depth + 1,
            label: 'Loading columns…',
          });
          continue;
        }

        if (entityColumns.length === 0) {
          result.push({
            key: `empty:${key}`,
            kind: 'empty',
            depth: depth + 1,
            label: 'No columns',
          });
          continue;
        }

        for (const column of entityColumns) {
          result.push({
            key: `column:${key}.${column.name}`,
            kind: 'column',
            depth: depth + 1,
            label: column.name,
            detail: column.dataType,
          });
        }
      }
    };

    if (!useSchemas) {
      appendEntities([...grouped.values()].flat(), base);
      return result;
    }

    for (const [schema, list] of [...grouped.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      const key = schemaKey(schema);
      const open = filtering || expanded.value.has(key);

      result.push({
        key,
        kind: 'schema',
        depth: base,
        label: schema || 'default',
        detail: String(list.length),
        expanded: open,
        groupKey: key,
      });

      if (open) appendEntities(list, base + 1);
    }

    return result;
  });

  function reset(): void {
    schemas.value = [];
    entities.value = [];
    columns.value = new Map();
    expanded.value = new Set();
    collapsedDatabases.value = new Set();
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
    toggleGroup,
    collapseAll,
    reset,
  };
});
