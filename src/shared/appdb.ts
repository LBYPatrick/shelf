import type { AiProvider, AiProviderInput } from './ai';
import type { ConnectionConfig } from '../drivers/types';
import type { ConnectionFolder, SaveConnectionInput, SavedConnection } from './connections';
import type { StorageCategoryId, StorageUsage } from './storage';

export interface HistoryInput {
  readonly connectionId: string | null;
  readonly text: string;
  readonly rowCount: number | null;
  readonly durationMs: number | null;
  readonly succeeded: boolean;
}

export interface HistoryEntry extends HistoryInput {
  readonly id: string;
  readonly executedAt: number;
}

export interface SaveQueryInput {
  readonly id?: string;
  readonly name: string;
  readonly text: string;
  readonly connectionId: string | null;
}

export interface SavedQuery extends SaveQueryInput {
  readonly id: string;
  readonly connectionId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * A conversation as it is stored.
 *
 * `body` is the transcript, serialised — opaque to the main process, which has
 * no business knowing what a turn looks like. It is empty in a listing: forty
 * cards do not need forty transcripts to draw forty titles.
 */
export interface SavedChat {
  readonly id: string;
  readonly connectionId: string | null;
  readonly title: string;
  readonly body: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface SaveChatInput {
  readonly id?: string;
  readonly connectionId: string | null;
  readonly title: string;
  readonly body: string;
}

/**
 * Either an existing saved connection, whose secrets come from the keyring, or
 * a draft the user is editing, whose secrets they just typed.
 */
export type PrepareConnectionRequest =
  | { readonly kind: 'saved'; readonly connectionId: string }
  | {
      readonly kind: 'draft';
      readonly config: Omit<ConnectionConfig, 'password'>;
      readonly secrets?: Readonly<Record<string, string>>;
      /** Fall back to this saved connection's stored secrets for blank fields. */
      readonly basedOn?: string;
    };

/**
 * Channels served by the main process, which owns the application database and
 * the keyring. Kept separate from the connection-host contract because these
 * are local bookkeeping, not database traffic.
 */
export const APPDB_CHANNELS = {
  listConnections: 'appdb:connections:list',
  listFolders: 'appdb:folders:list',
  saveConnection: 'appdb:connections:save',
  removeConnection: 'appdb:connections:remove',
  markConnectionUsed: 'appdb:connections:mark-used',
  prepareConnection: 'appdb:connections:prepare',
  secretsAvailable: 'appdb:secrets:available',
  revealSecrets: 'appdb:secrets:reveal',
  recordHistory: 'appdb:history:record',
  listHistory: 'appdb:history:list',
  clearHistory: 'appdb:history:clear',
  listSavedQueries: 'appdb:saved:list',
  saveQuery: 'appdb:saved:save',
  removeSavedQuery: 'appdb:saved:remove',
  listAiProviders: 'appdb:ai:list',
  saveAiProvider: 'appdb:ai:save',
  removeAiProvider: 'appdb:ai:remove',
  revealAiKey: 'appdb:ai:reveal',
  prepareAiProvider: 'appdb:ai:prepare',
  listChats: 'appdb:chats:list',
  readChat: 'appdb:chats:read',
  saveChat: 'appdb:chats:save',
  renameChat: 'appdb:chats:rename',
  removeChat: 'appdb:chats:remove',
  getSetting: 'appdb:settings:get',
  setSetting: 'appdb:settings:set',
  storageUsage: 'appdb:storage:usage',
  clearStorage: 'appdb:storage:clear',
} as const;

export interface AppDbApi {
  listConnections(): Promise<SavedConnection[]>;
  listFolders(): Promise<ConnectionFolder[]>;
  saveConnection(input: SaveConnectionInput): Promise<SavedConnection>;
  removeConnection(id: string): Promise<void>;
  markConnectionUsed(id: string): Promise<void>;
  /**
   * Stages a connection's credentials with the host and returns an opaque,
   * single-use handle. The configuration — which contains the password — is
   * sent from main to the host directly and never enters the renderer.
   */
  prepareConnection(request: PrepareConnectionRequest): Promise<string>;
  secretsAvailable(): Promise<boolean>;
  /**
   * The secrets of a connection the user has opened for editing.
   *
   * The general rule is that credentials go keyring → main → host and the
   * interface never sees them. This is the one deliberate exception: a form
   * that will not show you what it already holds forces you to retype a
   * password to change a port, and "leave blank to keep the saved one" is a
   * rule the reader has to be told and then remember. The exception is narrow —
   * one connection, named, only while its editor is open — and it reveals
   * nothing the user could not read out of the OS keychain themselves.
   */
  revealSecrets(connectionId: string): Promise<Readonly<Record<string, string>>>;

  recordHistory(entry: HistoryInput): Promise<void>;
  listHistory(connectionId: string | null): Promise<HistoryEntry[]>;
  clearHistory(connectionId: string | null): Promise<void>;
  listSavedQueries(connectionId: string | null): Promise<SavedQuery[]>;
  saveQuery(input: SaveQueryInput): Promise<SavedQuery>;
  removeSavedQuery(id: string): Promise<void>;
  /** Configured assistant providers. Never carries a key. */
  listAiProviders(): Promise<AiProvider[]>;
  saveAiProvider(input: AiProviderInput): Promise<AiProvider>;
  removeAiProvider(id: string): Promise<void>;
  /**
   * The key of the provider currently open in its editor.
   *
   * The same deliberate exception the connection editor takes, for the same
   * reason: a field that will not show what it holds turns changing a model
   * name into an act of finding your API key again, and "leave blank to keep
   * the saved one" is a rule the reader has to be told and then remember.
   */
  revealAiKey(id: string): Promise<string>;
  /**
   * Stages a provider and its key with the host and hands back an opaque,
   * single-use handle — the assistant's counterpart of `prepareConnection`.
   */
  prepareAiProvider(id: string): Promise<string>;
  /** Conversations with the assistant, newest first. Listings carry no body. */
  listChats(connectionId: string | null): Promise<SavedChat[]>;
  readChat(id: string): Promise<SavedChat | undefined>;
  saveChat(input: SaveChatInput): Promise<SavedChat>;
  renameChat(id: string, title: string): Promise<void>;
  removeChat(id: string): Promise<void>;
  getSetting<T>(key: string, fallback: T): Promise<T>;
  setSetting(key: string, value: unknown): Promise<void>;

  /**
   * What the app is holding on this machine, by category.
   *
   * Measured on demand rather than kept: it is a directory listing and half a
   * dozen counts, and a cached figure that says a gigabyte after the gigabyte
   * has been deleted is worse than no figure at all.
   */
  storageUsage(): Promise<StorageUsage>;
  /** Empties the categories named. Everything else is left exactly as it was. */
  clearStorage(categories: readonly StorageCategoryId[]): Promise<StorageUsage>;
}
