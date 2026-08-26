import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { EntityRef } from '@drivers/types';
import { saveSetting } from '../lib/settings';
import { entityKey } from './entities';

/*
 * `structure` was a fourth kind until the Properties popup replaced it. A tab
 * nothing can open is dead weight the compiler cannot see, so it went — and
 * `restore` drops any that a session saved before it did.
 */
export type TabKind = 'table' | 'query' | 'erd' | 'job' | 'chat';

export interface Tab {
  readonly id: string;
  kind: TabKind;
  title: string;
  subtitle?: string;
  entity?: EntityRef;
  /** Editor text for query tabs, kept here so it survives tab switches. */
  text?: string;
  /** Which dispatched job a job tab is showing. */
  jobId?: string;
  /**
   * What a diagram is a diagram *of*.
   *
   * A whole connection at once is a hairball: two hundred tables laid out by a
   * force simulation fill a canvas no screen can show at a legible size, and
   * the answer to "which tables reference this one" is in there somewhere. A
   * diagram is opened from a database or a schema, and shows that.
   */
  scope?: { readonly kind: 'database' | 'schema'; readonly name: string };
  /**
   * What a conversation was opened *on*.
   *
   * Wider than `scope` — a chat can be about one table, which a diagram cannot
   * usefully be — so it is its own field rather than a widening of that one.
   * The tab carries it; the conversation itself lives in the assistant store and
   * is deliberately not persisted.
   */
  /** The saved conversation this tab is showing, once it has been written. */
  chatId?: string;
  ask?:
    | { readonly kind: 'connection' }
    | { readonly kind: 'database'; readonly name: string }
    | { readonly kind: 'schema'; readonly name: string }
    | { readonly kind: 'entity'; readonly entity: EntityRef };
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

  function openErd(scope?: Tab['scope']): Tab {
    const existing = tabs.value.find(
      (tab) => tab.kind === 'erd' && tab.scope?.name === scope?.name
    );
    if (existing) {
      focus(existing.id);
      return existing;
    }

    const tab: Tab = {
      id: nextId(),
      kind: 'erd',
      // The specific thing first and what it is second, the way a table tab
      // carries its name over its schema.
      title: scope?.name ?? 'Diagram',
      ...(scope ? { subtitle: 'Diagram', scope } : {}),
      unsaved: false,
    };
    tabs.value = [...tabs.value, tab];
    focus(tab.id);
    return tab;
  }

  /**
   * Names a tab whatever the reader wants it called.
   *
   * A workspace with six query tabs in it is six tabs called Query, Query 2 and
   * so on — names the app made up because it had to call them something, and
   * which say nothing about what is in them.
   */
  function rename(id: string, title: string): void {
    const trimmed = title.trim();
    if (!trimmed) return;

    const tab = tabs.value.find((candidate) => candidate.id === id);
    if (!tab || tab.title === trimmed) return;

    tabs.value = tabs.value.map((candidate) =>
      candidate.id === id ? { ...candidate, title: trimmed } : candidate
    );
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

  /**
   * A conversation, always a new one.
   *
   * Unlike a table or a diagram, opening a second chat about the same schema is
   * a thing people mean to do: the first one has a thread of questions in it
   * that a new question would be changing the subject of. So this makes one
   * every time and does not look for an existing tab to focus.
   */
  function openChat(ask?: Tab['ask'], title?: string): Tab {
    const count = tabs.value.filter((tab) => tab.kind === 'chat').length;
    const tab: Tab = {
      id: nextId(),
      kind: 'chat',
      title: title ?? (count === 0 ? 'Assistant' : `Assistant ${count + 1}`),
      ...(ask ? { ask } : {}),
      unsaved: false,
    };

    tabs.value = [...tabs.value, tab];
    focus(tab.id);
    return tab;
  }

  /**
   * Opens a dispatched job's rows, or focuses the tab already showing them.
   *
   * Keyed by the job rather than by position, so clicking the same job twice
   * does not accumulate two views of one file.
   */
  function openJob(jobId: string, title: string): Tab {
    const existing = tabs.value.find((tab) => tab.kind === 'job' && tab.jobId === jobId);
    if (existing) {
      existing.title = title;
      focus(existing.id);
      return existing;
    }

    const tab: Tab = { id: nextId(), kind: 'job', title, jobId, unsaved: false };
    tabs.value = [...tabs.value, tab];
    focus(tab.id);
    return tab;
  }

  /** Closes the view of a job, for when the job itself is being discarded. */
  function closeJob(jobId: string): void {
    const tab = tabs.value.find((entry) => entry.kind === 'job' && entry.jobId === jobId);
    if (tab) close(tab.id);
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

    /*
     * A job tab is deliberately not restored. Its rows live in a spool under
     * the OS temp directory, which the machine is free to sweep between
     * launches — so a restored one would be a tab that opens onto a file that
     * may not be there. The job itself survives in the jobs list, which is
     * where its state belongs.
     */
    /*
     * A chat tab is not restored either, and for a reason of its own rather
     * than the spool's: the conversation is not saved anywhere. Bringing back
     * the tab would bring back an empty one under a title that promises a
     * thread, which is worse than not bringing it back at all.
     */
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
          void saveSetting(sessionKey(connectionId), {
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
    openChat,
    rename,
    openJob,
    closeJob,
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
