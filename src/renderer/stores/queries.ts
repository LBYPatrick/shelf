import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { HistoryEntry, SavedQuery } from '@shared/appdb';
import { copyName } from '@shared/copyName';
import { useConnections } from './connections';

/**
 * Query history and saved queries.
 *
 * History is written after every run, including failures — a statement that
 * errored is exactly the one you want to find again and fix.
 */
export const useQueries = defineStore('queries', () => {
  const connections = useConnections();

  const history = ref<HistoryEntry[]>([]);
  const saved = ref<SavedQuery[]>([]);
  const filter = ref('');
  /** Show every connection's history, not just this one's. */
  const showAll = ref(false);

  function scope(): string | null {
    return showAll.value ? null : (connections.active?.id ?? null);
  }

  async function refresh(): Promise<void> {
    const connectionId = scope();
    const [entries, savedQueries] = await Promise.all([
      window.shelf.db.listHistory(connectionId),
      window.shelf.db.listSavedQueries(connections.active?.id ?? null),
    ]);
    history.value = entries;
    saved.value = savedQueries;
  }

  async function record(entry: {
    text: string;
    rowCount: number | null;
    durationMs: number | null;
    succeeded: boolean;
  }): Promise<void> {
    await window.shelf.db.recordHistory({
      connectionId: connections.active?.id ?? null,
      ...entry,
    });
    await refresh();
  }

  async function save(name: string, text: string, id?: string): Promise<SavedQuery> {
    const result = await window.shelf.db.saveQuery({
      ...(id ? { id } : {}),
      name,
      text,
      connectionId: connections.active?.id ?? null,
    });
    await refresh();
    return result;
  }

  /**
   * A second copy of one, under a name that is not already taken.
   *
   * The reason to want one is nearly always a variant — the same statement with
   * a different date range — so it is filed rather than opened: you get it, the
   * original is untouched, and the list is where you rename it.
   *
   * `word` comes from the caller because it is shown to the reader and this app
   * is translated; everything else about the naming is in `shared/copyName.ts`,
   * shared with the connection list so the two cannot disagree.
   */
  async function duplicate(query: SavedQuery, word: string): Promise<SavedQuery> {
    const taken = saved.value.map((entry) => entry.name);
    return save(copyName(query.name, taken, word), query.text);
  }

  async function remove(id: string): Promise<void> {
    await window.shelf.db.removeSavedQuery(id);
    await refresh();
  }

  async function clearHistory(): Promise<void> {
    await window.shelf.db.clearHistory(scope());
    await refresh();
  }

  function matches(text: string): boolean {
    const needle = filter.value.trim().toLowerCase();
    return !needle || text.toLowerCase().includes(needle);
  }

  const visibleHistory = computed(() => history.value.filter((entry) => matches(entry.text)));

  const visibleSaved = computed(() =>
    saved.value.filter((query) => matches(query.name) || matches(query.text))
  );

  return {
    history,
    saved,
    filter,
    showAll,
    visibleHistory,
    visibleSaved,
    refresh,
    record,
    save,
    duplicate,
    remove,
    clearHistory,
  };
});
