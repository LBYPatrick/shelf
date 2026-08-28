import type { ShelfApi } from '../../src/preload';
import type { AiProvider, AiProviderInput } from '@shared/ai';
import type { HistoryEntry, SavedChat, SavedQuery } from '@shared/appdb';
import type { SavedConnection } from '@shared/connections';
import type { StorageUsage } from '@shared/storage';
import { FOLDERS, SAVED_CONNECTIONS } from '../fixtures/database';

/** A machine that has been used: one huge category and several small ones. */
const USAGE: StorageUsage = {
  directory: '/Users/you/Library/Application Support/Shelf',
  categories: [
    { id: 'history', items: 412, bytes: 96_400 },
    { id: 'chats', items: 9, bytes: 184_000 },
    { id: 'jobs', items: 3, bytes: 214_000_000 },
    { id: 'workspace', items: 14, bytes: 21_000 },
    { id: 'saved', items: 6, bytes: 8_200 },
    { id: 'providers', items: 2, bytes: 120 },
    { id: 'connections', items: 4, bytes: 1_900 },
  ],
};

/**
 * The preload bridge, in a browser.
 *
 * Every store in this app reaches the outside world through `window.shelf`, so
 * nothing renders in a storybook until something is there. This is that
 * something: the whole surface, backed by objects in memory.
 *
 * It is a real implementation rather than a pile of `() => Promise.resolve()`.
 * Settings written by a story are read back by the next component that asks for
 * them, saving a connection puts it in the list, and removing one takes it out
 * — because the interesting stories are the ones where a control changes
 * something and the interface has to answer. A bridge that forgets everything
 * can only ever show the empty state.
 *
 * Typed as `ShelfApi`, so a channel added to the preload script and not added
 * here fails the type check rather than failing in a story nobody opened.
 */

/** What the mock remembers between calls, resettable per story. */
interface Store {
  settings: Map<string, unknown>;
  connections: SavedConnection[];
  history: HistoryEntry[];
  saved: SavedQuery[];
  providers: AiProvider[];
  chats: SavedChat[];
  keys: Map<string, string>;
  keyringAvailable: boolean;
}

const fresh = (): Store => ({
  settings: new Map(),
  connections: [...SAVED_CONNECTIONS],
  history: [
    {
      id: 'h1',
      connectionId: 'conn-local',
      text: 'select * from music.album order by released desc limit 50',
      rowCount: 50,
      durationMs: 12,
      succeeded: true,
      executedAt: Date.now() - 60_000,
    },
    {
      id: 'h2',
      connectionId: 'conn-local',
      text: 'select count(*) from music.trck',
      rowCount: null,
      durationMs: null,
      succeeded: false,
      executedAt: Date.now() - 300_000,
    },
    {
      id: 'h3',
      connectionId: 'conn-local',
      text: 'update ops.daily_metrics set revenue = revenue * 1.0 where day = current_date',
      rowCount: 1,
      durationMs: 340,
      succeeded: true,
      executedAt: Date.now() - 3_600_000,
    },
  ],
  saved: [
    {
      id: 's1',
      name: 'Longest albums',
      text: 'select title, runtime_seconds from music.album order by runtime_seconds desc',
      connectionId: 'conn-local',
      createdAt: Date.now() - 86_400_000,
      updatedAt: Date.now() - 86_400_000,
    },
    {
      id: 's2',
      name: 'Daily revenue',
      text: 'select day, revenue from ops.daily_metrics order by day desc limit 30',
      connectionId: null,
      createdAt: Date.now() - 172_800_000,
      updatedAt: Date.now() - 172_800_000,
    },
  ],
  providers: [],
  chats: [],
  keys: new Map(),
  keyringAvailable: true,
});

let store = fresh();

/** Called between stories so one story's writes never leak into the next. */
export function resetShelf(over: Partial<Store> = {}): void {
  store = { ...fresh(), ...over };
}

/** Lets a story seed or inspect what the bridge is holding. */
export function shelfStore(): Store {
  return store;
}

/**
 * A round trip that takes a moment.
 *
 * Resolving synchronously would hide every loading state in the app — a
 * skeleton that never appears is a skeleton nobody can review. Short enough not
 * to make the storybook feel broken.
 */
const settle = <T>(value: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

const noop = () => undefined;

export const mockShelf: ShelfApi = {
  window: {
    minimize: noop,
    toggleMaximize: noop,
    close: noop,
    isMaximized: () => settle(false, 0),
    setAppearance: noop,
    setCompact: noop,
    // A browser has no desktop to put a banner on, and a story that raised one
    // would raise it on whoever is reading the storybook.
    notify: noop,
    onMaximizedChanged: () => noop,
  },

  host: {
    // The port never arrives, and nothing waits for it: `mockHost` replaces the
    // client's methods outright rather than feeding it a channel.
    requestPort: noop,
    onRestarted: () => noop,
    onUnavailable: () => noop,
  },

  db: {
    listConnections: () => settle([...store.connections]),
    listFolders: () => settle([...FOLDERS]),
    saveConnection: (input) => {
      const id = input.id ?? `conn-${store.connections.length + 1}`;
      const existing = store.connections.find((connection) => connection.id === id);
      const saved: SavedConnection = {
        id,
        name: input.name,
        engine: input.engine,
        folderId: input.folderId ?? null,
        position: existing?.position ?? store.connections.length,
        labelColor: input.labelColor ?? null,
        pinned: input.pinned ?? false,
        readOnly: input.readOnly ?? false,
        rememberSecrets: input.rememberSecrets,
        config: input.config,
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        lastUsedAt: existing?.lastUsedAt ?? null,
      };
      store.connections = existing
        ? store.connections.map((c) => (c.id === id ? saved : c))
        : [...store.connections, saved];
      return settle(saved);
    },
    removeConnection: (id) => {
      store.connections = store.connections.filter((connection) => connection.id !== id);
      return settle(undefined);
    },
    markConnectionUsed: () => settle(undefined),
    prepareConnection: () => settle('story-handle'),
    secretsAvailable: () => settle(store.keyringAvailable),
    revealSecrets: () => settle({ password: 'hunter2' }),

    recordHistory: (entry) => {
      store.history = [
        { ...entry, id: `h${store.history.length + 1}`, executedAt: Date.now() },
        ...store.history,
      ];
      return settle(undefined);
    },
    listHistory: (connectionId) =>
      settle(
        store.history.filter(
          (entry) => connectionId === null || entry.connectionId === connectionId
        )
      ),
    clearHistory: () => {
      store.history = [];
      return settle(undefined);
    },

    listSavedQueries: (connectionId) =>
      settle(
        store.saved.filter(
          (query) => connectionId === null || query.connectionId === connectionId
        )
      ),
    saveQuery: (input) => {
      const id = input.id ?? `s${store.saved.length + 1}`;
      const query: SavedQuery = {
        id,
        name: input.name,
        text: input.text,
        connectionId: input.connectionId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      store.saved = store.saved.some((entry) => entry.id === id)
        ? store.saved.map((entry) => (entry.id === id ? query : entry))
        : [...store.saved, query];
      return settle(query);
    },
    removeSavedQuery: (id) => {
      store.saved = store.saved.filter((query) => query.id !== id);
      return settle(undefined);
    },

    listAiProviders: () => settle([...store.providers]),
    saveAiProvider: (input: AiProviderInput) => {
      const id = input.id ?? `ai-${store.providers.length + 1}`;
      const provider: AiProvider = {
        id,
        name: input.name,
        driver: input.driver,
        model: input.model,
        ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
        createdAt: Date.now(),
      };
      store.providers = store.providers.some((entry) => entry.id === id)
        ? store.providers.map((entry) => (entry.id === id ? provider : entry))
        : [...store.providers, provider];
      if (input.apiKey !== undefined) store.keys.set(id, input.apiKey);
      return settle(provider);
    },
    removeAiProvider: (id) => {
      store.providers = store.providers.filter((provider) => provider.id !== id);
      store.keys.delete(id);
      return settle(undefined);
    },
    revealAiKey: (id) => settle(store.keys.get(id) ?? ''),
    prepareAiProvider: () => settle('story-ai-handle'),

    listChats: (connectionId) =>
      settle(
        store.chats.filter((chat) => connectionId === null || chat.connectionId === connectionId)
      ),
    readChat: (id) => settle(store.chats.find((chat) => chat.id === id)),
    saveChat: (input) => {
      const id = input.id ?? `chat-${store.chats.length + 1}`;
      const now = Date.now();
      const existing = store.chats.find((chat) => chat.id === id);
      const saved: SavedChat = {
        id,
        connectionId: input.connectionId,
        title: input.title,
        body: input.body,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      store.chats = existing
        ? store.chats.map((chat) => (chat.id === id ? saved : chat))
        : [saved, ...store.chats];
      return settle(saved);
    },
    renameChat: (id, title) => {
      store.chats = store.chats.map((chat) =>
        chat.id === id ? { ...chat, title: title.trim() } : chat
      );
      return settle(undefined);
    },
    removeChat: (id) => {
      store.chats = store.chats.filter((chat) => chat.id !== id);
      return settle(undefined);
    },

    getSetting: <T,>(key: string, fallback: T) =>
      settle(store.settings.has(key) ? (store.settings.get(key) as T) : fallback, 0),
    setSetting: (key, value) => {
      store.settings.set(key, value);
      return settle(undefined, 0);
    },

    /*
     * A machine with a real amount of data on it, so the storage sheet shows
     * what it is for: one category far larger than the rest. Zeroes everywhere
     * would only ever draw the empty state.
     */
    storageUsage: () => settle(USAGE),
    clearStorage: (categories) =>
      settle({
        ...USAGE,
        categories: USAGE.categories.map((category) =>
          categories.includes(category.id) ? { ...category, items: 0, bytes: 0 } : category
        ),
      }),
  },

  dialogs: {
    // A file dialog cannot open here, so each one answers the way a person who
    // picked something would. Cancelling is a story of its own where it matters.
    openFile: () => settle('/Users/you/Documents/albums.csv'),
    saveFile: () => settle('/Users/you/Documents/export.csv'),
    readTextFile: () =>
      settle({
        path: '/Users/you/Documents/settings.json',
        text: '{\n  "kind": "shelf.settings",\n  "version": 1\n}\n',
      }),
    writeTextFile: () => settle('/Users/you/Documents/export.json'),
    writeBinaryFile: () => settle('/Users/you/Documents/plan.png'),
  },

  platformInfo: () =>
    settle(
      {
        platform: 'macos',
        nativeWindowControls: true,
        windowControlsInset: 78,
        appVersion: '1.0.0',
        locale: 'en-US',
      },
      0
    ),
};

/** Puts the bridge on the window, once, before anything reads it. */
export function installShelf(): void {
  Object.defineProperty(window, 'shelf', {
    value: mockShelf,
    writable: false,
    configurable: true,
  });
}
