import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Capabilities, ConnectionConfig, EngineId } from '@drivers/types';
import type { PrepareConnectionRequest } from '@shared/appdb';
import type {
  ConnectionFolder,
  SaveConnectionInput,
  SavedConnection,
} from '@shared/connections';
import { host } from '../lib/host';
import { copyName } from '@shared/copyName';
import { errorMessage } from '@shared/errors';

export interface LiveConnection {
  readonly id: string;
  readonly name: string;
  readonly engine: EngineId;
  readonly capabilities: Capabilities;
  readonly version: string;
  readonly labelColor: string | null;
  readonly readOnly: boolean;
  /**
   * The database this connection is inside, when it is inside a named one.
   *
   * The sidebar's top folder. A file-backed engine has no such thing — the file
   * *is* the database — so it is null there and the tree starts a level down.
   */
  readonly database: string | null;
}

export type ConnectStatus =
  | { state: 'idle' }
  | { state: 'connecting'; connectionId: string }
  | { state: 'failed'; connectionId: string; message: string };

/**
 * Saved connections and whichever one is currently open.
 *
 * Passwords never appear here. Opening a connection asks main to stage the
 * credentials with the connection host and returns an opaque handle, so the
 * secret goes keyring → main → host without ever entering this process.
 */
export const useConnections = defineStore('connections', () => {
  const saved = ref<SavedConnection[]>([]);
  const folders = ref<ConnectionFolder[]>([]);
  const active = ref<LiveConnection | null>(null);
  const status = ref<ConnectStatus>({ state: 'idle' });
  const keyringAvailable = ref(true);

  const pinned = computed(() => saved.value.filter((connection) => connection.pinned));

  const recent = computed(() =>
    saved.value
      .filter((connection) => connection.lastUsedAt !== null)
      .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
      .slice(0, 5)
  );

  async function refresh(): Promise<void> {
    const [connections, folderList, keyring] = await Promise.all([
      window.shelf.db.listConnections(),
      window.shelf.db.listFolders(),
      window.shelf.db.secretsAvailable(),
    ]);
    saved.value = connections;
    folders.value = folderList;
    keyringAvailable.value = keyring;
  }

  /**
   * The one door a connection is written through, and where it stops being
   * reactive.
   *
   * Nothing reactive crosses a bridge: the context bridge structured-clones
   * what it carries and a Vue proxy is rejected outright, asynchronously and
   * with nothing but "An object could not be cloned" in a console nobody has
   * open. Every caller until now assembled a plain object from a form, so this
   * held by luck; `duplicate` reads a `config` straight off this store's own
   * reactive list and would not have. Serialising here is the same answer
   * `lib/host.ts` and `lib/settings.ts` give — at the boundary, so no call site
   * has to remember.
   */
  async function save(input: SaveConnectionInput): Promise<SavedConnection> {
    const result = await window.shelf.db.saveConnection(
      JSON.parse(JSON.stringify(input)) as SaveConnectionInput
    );
    await refresh();
    return result;
  }

  /**
   * A second connection with the same details, under a name that is free.
   *
   * The reason to want one is a neighbour — the same server with a different
   * database, staging beside production — so it is filed rather than opened in
   * the editor: the copy exists, nothing was lost if you change your mind, and
   * the pencil is in the row beside it.
   *
   * The secrets go with it. A duplicate that cannot connect is not a duplicate,
   * and this is the same machine, the same keyring and the same reader — the
   * bytes never leave, unlike the export, which is the one artefact that does
   * and says so in three places. A connection with nothing stored copies
   * nothing, and one whose keyring is unreadable copies as much as it can
   * rather than failing: the password field is the thing you were going to open
   * it to change.
   */
  async function duplicate(
    connection: SavedConnection,
    word: string
  ): Promise<SavedConnection> {
    const secrets = await window.shelf.db.revealSecrets(connection.id).catch(() => ({}));
    const taken = saved.value.map((entry) => entry.name);

    return save({
      name: copyName(connection.name, taken, word),
      engine: connection.engine,
      folderId: connection.folderId,
      labelColor: connection.labelColor,
      pinned: connection.pinned,
      readOnly: connection.readOnly,
      rememberSecrets: connection.rememberSecrets,
      config: connection.config,
      ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
    });
  }

  async function remove(id: string): Promise<void> {
    await window.shelf.db.removeConnection(id);
    if (active.value?.id === id) await disconnect();
    await refresh();
  }

  async function test(
    request: PrepareConnectionRequest
  ): Promise<{ ok: true; version: string } | { ok: false; message: string }> {
    try {
      const handle = await window.shelf.db.prepareConnection(request);
      return await host.call('conn/test', { handle });
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  async function connect(connection: SavedConnection): Promise<boolean> {
    // Only one connection is open at a time; the workspace is built around a
    // single database, and leaving the previous one open would hold its
    // resources for a window nobody is looking at.
    if (active.value) await disconnect();

    status.value = { state: 'connecting', connectionId: connection.id };

    try {
      const handle = await window.shelf.db.prepareConnection({
        kind: 'saved',
        connectionId: connection.id,
      });

      const { capabilities, version } = await host.call('conn/open', {
        connectionId: connection.id,
        handle,
      });

      active.value = {
        id: connection.id,
        name: connection.name,
        engine: connection.engine,
        capabilities,
        version,
        labelColor: connection.labelColor,
        readOnly: connection.readOnly,
        database: connection.config.database ?? null,
      };

      status.value = { state: 'idle' };
      await window.shelf.db.markConnectionUsed(connection.id);
      await refresh();
      return true;
    } catch (error) {
      status.value = {
        state: 'failed',
        connectionId: connection.id,
        message: errorMessage(error),
      };
      return false;
    }
  }

  async function disconnect(): Promise<void> {
    const current = active.value;
    active.value = null;
    if (!current) return;
    await host.call('conn/close', { connectionId: current.id }).catch(() => undefined);
  }

  /** The host restarted, so whatever was open is gone. */
  function handleHostLost(): void {
    active.value = null;
  }

  function draftConfig(engine: EngineId): Omit<ConnectionConfig, 'password'> {
    return { engine };
  }

  /**
   * Opens the built-in sample database.
   *
   * It is not saved: it exists to be looked at, and leaving a phantom entry in
   * the user's connection list afterwards would be clutter they did not ask for.
   */
  async function exploreSample(): Promise<boolean> {
    if (active.value) await disconnect();

    status.value = { state: 'connecting', connectionId: 'sample' };

    try {
      const handle = await window.shelf.db.prepareConnection({
        kind: 'draft',
        config: { engine: 'mock' },
      });

      const { capabilities, version } = await host.call('conn/open', {
        connectionId: 'sample',
        handle,
      });

      active.value = {
        id: 'sample',
        name: 'Sample data',
        engine: 'mock',
        capabilities,
        version,
        labelColor: null,
        readOnly: false,
        database: 'sample',
      };

      status.value = { state: 'idle' };
      return true;
    } catch (error) {
      status.value = {
        state: 'failed',
        connectionId: 'sample',
        message: errorMessage(error),
      };
      return false;
    }
  }

  /**
   * The open connection's id, or a throw.
   *
   * Every tab needs this before it can ask the host anything, and each one used
   * to carry its own identical four-line copy of it — including the store
   * itself, which is where it belonged all along.
   */
  function requireId(): string {
    const id = active.value?.id;
    if (!id) throw new Error('No open connection');
    return id;
  }

  return {
    saved,
    folders,
    pinned,
    recent,
    active,
    requireId,
    status,
    keyringAvailable,
    refresh,
    save,
    duplicate,
    remove,
    test,
    connect,
    disconnect,
    handleHostLost,
    draftConfig,
    exploreSample,
  };
});
