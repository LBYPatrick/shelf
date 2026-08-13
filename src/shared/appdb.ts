import type { ConnectionConfig } from '../drivers/types';
import type { ConnectionFolder, SaveConnectionInput, SavedConnection } from './connections';

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
  recordHistory: 'appdb:history:record',
  listHistory: 'appdb:history:list',
  clearHistory: 'appdb:history:clear',
  listSavedQueries: 'appdb:saved:list',
  saveQuery: 'appdb:saved:save',
  removeSavedQuery: 'appdb:saved:remove',
  getSetting: 'appdb:settings:get',
  setSetting: 'appdb:settings:set',
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

  recordHistory(entry: HistoryInput): Promise<void>;
  listHistory(connectionId: string | null): Promise<HistoryEntry[]>;
  clearHistory(connectionId: string | null): Promise<void>;
  listSavedQueries(connectionId: string | null): Promise<SavedQuery[]>;
  saveQuery(input: SaveQueryInput): Promise<SavedQuery>;
  removeSavedQuery(id: string): Promise<void>;
  getSetting<T>(key: string, fallback: T): Promise<T>;
  setSetting(key: string, value: unknown): Promise<void>;
}
