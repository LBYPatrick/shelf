import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
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
 * A key per entity, where `entityKey` is a key per *name*.
 *
 * Postgres overloads share a name inside a schema — pgcrypto alone ships seven
 * `pgp_pub_decrypt` and two `hmac` — so the path is the same string for every
 * one of them. That string was the `v-for` key, and duplicate keys let Vue
 * patch rows into each other's slots: items vanished while scrolling, the list
 * would not reach its end, and a table expanded its columns somewhere other
 * than under itself. It was also the key for what is expanded and for the
 * loaded columns, so one overload standing in for all of them.
 *
 * The ordinal is taken from the driver's own order, which is stable for a given
 * schema, so an expanded row stays expanded across a refresh.
 */
function identify(list: readonly Entity[]): Map<Entity, string> {
  const seen = new Map<string, number>();
  const ids = new Map<Entity, string>();

  for (const entity of list) {
    const path = entityKey(entity);
    const nth = seen.get(path) ?? 0;
    seen.set(path, nth + 1);
    ids.set(entity, nth === 0 ? path : `${path}#${nth}`);
  }

  return ids;
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

  const showTables = ref(true);
  const showViews = ref(true);
  const showRoutines = ref(true);

  /**
   * Whether to ask for what the engine brought with it.
   *
   * Off, and the *server* is asked not to send them — a Postgres with PostGIS
   * on it answers `listEntities` with a thousand `st_*` functions, and the
   * three tables somebody actually wrote are somewhere in the middle of that.
   * Which is why this is not a filter over `entities`: turning it on is a
   * refresh, because turning it on is asking a different question.
   */
  const showBuiltIns = ref(false);

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
        host.call('schema/entities', { connectionId: id, builtIns: showBuiltIns.value }),
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

  /*
   * The switch is a question for the server, not a filter over an answer it
   * already gave. So flipping it re-asks — here rather than at the control, so
   * that the palette's row and the sidebar's switch cannot disagree about
   * whether asking is part of setting it.
   */
  watch(showBuiltIns, () => void refresh());

  async function loadColumns(entity: Entity): Promise<void> {
    const key = idOf(entity);
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
    const key = idOf(entity);
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

  /*
   * The kind filters remain; the name filter does not. Narrowing the tree by
   * typing moved into the palette, which searches the whole database by path or
   * by pattern instead of hiding rows in the one view of it.
   */
  /* Computed from the whole list, so an entity's identity does not change when
     a kind is filtered out from under it. */
  const identities = computed(() => identify(entities.value));

  const idOf = (entity: Entity): string => identities.value.get(entity) ?? entityKey(entity);

  const visibleEntities = computed(() =>
    entities.value.filter((entity) => {
      if (entity.kind === 'routine' && !showRoutines.value) return false;
      if ((entity.kind === 'view' || entity.kind === 'materialized-view') && !showViews.value) {
        return false;
      }
      if ((entity.kind === 'table' || entity.kind === 'collection') && !showTables.value) {
        return false;
      }
      return true;
    })
  );

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
   */
  const rows = computed<TreeRow[]>(() => {
    const grouped = new Map<string, Entity[]>();
    for (const entity of visibleEntities.value) {
      const schema = entity.schema ?? '';
      const list = grouped.get(schema);
      if (list) list.push(entity);
      else grouped.set(schema, [entity]);
    }

    const useSchemas = grouped.size > 1;

    const database = connections.active?.database ?? null;
    const dbKey = database ? databaseKey(database) : null;
    const dbOpen = !dbKey || !collapsedDatabases.value.has(dbKey);

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
        const key = idOf(entity);
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
      const open = expanded.value.has(key);

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

  /**
   * Opens every folder the tree is currently drawing, and no further.
   *
   * Not every folder there could be: opening a table loads its columns, so
   * "expand all" over five thousand tables would be five thousand round trips
   * fired at once. The folders here are the schemas and the database — the ones
   * that cost nothing to open, and the ones `collapseAll` shut.
   */
  function expandAll(): void {
    const schemasInUse = new Set(visibleEntities.value.map((entity) => entity.schema ?? ''));

    /*
     * A lone schema is not drawn as a folder at all — see `rows` — so there is
     * nothing there to mark open. Marking it anyway leaves `expanded` holding a
     * key for a row that does not exist, which is `allCollapsed` reading false
     * and Collapse offering to shut a tree that is already shut.
     */
    expanded.value =
      schemasInUse.size > 1 ? new Set([...schemasInUse].map(schemaKey)) : new Set();
    collapsedDatabases.value = new Set();
  }

  /**
   * Whether either end has already been reached.
   *
   * It is what disables each control at its own extreme, which is what makes
   * the pair read as a state — both live means the tree is part open — rather
   * than as two buttons that happen to sit together. Which means each end has
   * to be defined by what its button *does*, not by a symmetry the pair does
   * not have.
   *
   * `collapseAll` empties `expanded`, which is every schema folder and every
   * opened table, and leaves the database open — so "already collapsed" is that
   * set being empty, and the database's own state is no part of it. Defining it
   * as "every folder shut" instead disables the control never, because the
   * database is a folder that is open by design.
   *
   * `expandAll` opens the schemas and the database and stops there, so "already
   * expanded" is exactly the folders the tree is currently drawing.
   */
  const allCollapsed = computed(() => expanded.value.size === 0);

  const allExpanded = computed(() =>
    rows.value.every((row) => !row.groupKey || row.expanded === true)
  );

  function reset(): void {
    schemas.value = [];
    entities.value = [];
    columns.value = new Map();
    expanded.value = new Set();
    collapsedDatabases.value = new Set();
    error.value = null;
  }

  return {
    schemas,
    entities,
    columns,
    expanded,
    loading,
    error,
    showTables,
    showViews,
    showRoutines,
    showBuiltIns,
    visibleEntities,
    rows,
    allCollapsed,
    allExpanded,
    refresh,
    loadColumns,
    toggle,
    toggleGroup,
    collapseAll,
    expandAll,
    reset,
  };
});
