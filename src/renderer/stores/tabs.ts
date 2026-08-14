import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { EntityRef } from '@drivers/types';
import { entityKey } from './entities';

/*
 * `structure` was a fourth kind until the Properties popup replaced it. A tab
 * nothing can open is dead weight the compiler cannot see, so it went — and
 * `restore` drops any that a session saved before it did.
 */
export type TabKind = 'table' | 'query' | 'erd';

export interface Tab {
  readonly id: string;
  kind: TabKind;
  title: string;
  subtitle?: string;
  entity?: EntityRef;
  /** Editor text for query tabs, kept here so it survives tab switches. */
  text?: string;
  unsaved: boolean;
}

let counter = 0;
const nextId = () => `tab-${++counter}`;

/** What is persisted per connection. Kept minimal and forwards-compatible. */
interface StoredSession {
  readonly tabs: readonly Omit<Tab, 'unsaved'>[];
  readonly activeId: string | null;
}

const sessionKey = (connectionId: string) => `session:${connectionId}`;

/**
 * Open tabs.
 *
 * Opening the same table twice focuses the tab that already exists rather than
 * making a second one — a workspace that accumulates duplicates of the same
 * view is one the user has to tidy up by hand.
 */
export const useTabs = defineStore('tabs', () => {
  const tabs = ref<Tab[]>([]);
  const activeId = ref<string | null>(null);
  /** Closed tabs, most recent first, so reopening is possible. */
  const closed = ref<Tab[]>([]);

  const active = computed(() => tabs.value.find((tab) => tab.id === activeId.value) ?? null);

  function focus(id: string): void {
    activeId.value = id;
  }

  function find(kind: TabKind, entity?: EntityRef): Tab | undefined {
    return tabs.value.find((tab) => {
      if (tab.kind !== kind) return false;
      if (!entity || !tab.entity) return !entity && !tab.entity;
      return entityKey(tab.entity) === entityKey(entity);
    });
  }

  function openEntity(kind: 'table', entity: EntityRef): Tab {
    const existing = find(kind, entity);
    if (existing) {
      focus(existing.id);
      return existing;
    }

    const tab: Tab = {
      id: nextId(),
      kind,
      title: entity.name,
      ...(entity.schema ? { subtitle: entity.schema } : {}),
      entity,
      unsaved: false,
    };

    tabs.value = [...tabs.value, tab];
    focus(tab.id);
    return tab;
  }

  function openErd(): Tab {
    const existing = tabs.value.find((tab) => tab.kind === 'erd');
    if (existing) {
      focus(existing.id);
      return existing;
    }

    const tab: Tab = { id: nextId(), kind: 'erd', title: 'Diagram', unsaved: false };
    tabs.value = [...tabs.value, tab];
    focus(tab.id);
    return tab;
  }

  function openQuery(text = ''): Tab {
    const count = tabs.value.filter((tab) => tab.kind === 'query').length;
    const tab: Tab = {
      id: nextId(),
      kind: 'query',
      title: count === 0 ? 'Query' : `Query ${count + 1}`,
      text,
      unsaved: false,
    };

    tabs.value = [...tabs.value, tab];
    focus(tab.id);
    return tab;
  }

  function close(id: string): void {
    const index = tabs.value.findIndex((tab) => tab.id === id);
    if (index === -1) return;

    const [removed] = tabs.value.splice(index, 1);
    tabs.value = [...tabs.value];
    if (removed) closed.value = [removed, ...closed.value].slice(0, 20);

    if (activeId.value !== id) return;

    // Focus the neighbour rather than jumping to the end, which is where the
    // eye already is.
    const neighbour = tabs.value[index] ?? tabs.value[index - 1] ?? null;
    activeId.value = neighbour?.id ?? null;
  }

  function closeOthers(id: string): void {
    for (const tab of [...tabs.value]) {
      if (tab.id !== id) close(tab.id);
    }
  }

  function closeToRight(id: string): void {
    const index = tabs.value.findIndex((tab) => tab.id === id);
    if (index === -1) return;
    for (const tab of tabs.value.slice(index + 1)) close(tab.id);
  }

  function reopenLastClosed(): void {
    const [tab, ...rest] = closed.value;
    if (!tab) return;
    closed.value = rest;
    tabs.value = [...tabs.value, tab];
    focus(tab.id);
  }

  function move(fromIndex: number, toIndex: number): void {
    const next = [...tabs.value];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;
    next.splice(toIndex, 0, moved);
    tabs.value = next;
  }

  function nextTab(delta: number): void {
    if (tabs.value.length === 0) return;
    const index = tabs.value.findIndex((tab) => tab.id === activeId.value);
    const target = (index + delta + tabs.value.length) % tabs.value.length;
    focus(tabs.value[target]!.id);
  }

  function reset(): void {
    tabs.value = [];
    closed.value = [];
    activeId.value = null;
  }

  /**
   * Restores the tabs that were open against this connection last time.
   *
   * Editor text is restored with them, because a query you were part-way
   * through writing is exactly the thing you would be annoyed to lose. Tabs are
   * saved per connection rather than globally, so opening a different database
   * does not resurrect the previous one's tabs.
   */
  async function restore(connectionId: string): Promise<void> {
    reset();

    const stored = await window.shelf.db
      .getSetting<StoredSession | null>(sessionKey(connectionId), null)
      .catch(() => null);

    if (!stored?.tabs?.length) return;

    const KINDS: readonly string[] = ['table', 'query', 'erd'];
    // A session saved before a tab kind was removed still restores; it just
    // restores the tabs that still exist.
    tabs.value = stored.tabs
      .filter((tab) => KINDS.includes(tab.kind))
      .map((tab) => ({ ...tab, unsaved: false }));
    activeId.value =
      stored.activeId && tabs.value.some((tab) => tab.id === stored.activeId)
        ? stored.activeId
        : (tabs.value[0]?.id ?? null);

    // Keep generated ids from colliding with restored ones.
    for (const tab of tabs.value) {
      const numeric = Number(tab.id.replace('tab-', ''));
      if (Number.isFinite(numeric)) counter = Math.max(counter, numeric);
    }
  }

  /** Saves on every change, debounced so typing does not write continuously. */
  function persistTo(connectionId: string): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;

    return watch(
      [tabs, activeId],
      () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          void window.shelf.db.setSetting(sessionKey(connectionId), {
            tabs: tabs.value.map(({ unsaved: _unsaved, ...rest }) => rest),
            activeId: activeId.value,
          } satisfies StoredSession);
        }, 400);
      },
      { deep: true }
    );
  }

  return {
    tabs,
    activeId,
    active,
    closed,
    focus,
    openEntity,
    openErd,
    openQuery,
    close,
    closeOthers,
    closeToRight,
    reopenLastClosed,
    move,
    nextTab,
    reset,
    restore,
    persistTo,
  };
});
