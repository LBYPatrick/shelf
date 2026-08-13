import type { ConnectionConfig, EngineId } from '../drivers/types';

/**
 * A saved connection as the interface sees it.
 *
 * Secrets are deliberately absent: they live in the OS keyring and are merged
 * in by the main process at the moment of connecting, so they never sit in the
 * renderer's memory or in any state that gets persisted or logged.
 */
export interface SavedConnection {
  readonly id: string;
  readonly name: string;
  readonly engine: EngineId;
  readonly folderId: string | null;
  readonly position: number;
  readonly labelColor: string | null;
  readonly pinned: boolean;
  readonly readOnly: boolean;
  readonly rememberSecrets: boolean;
  /** Everything except passwords. */
  readonly config: Omit<ConnectionConfig, 'password'>;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastUsedAt: number | null;
}

export interface ConnectionFolder {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly position: number;
}

/** What the renderer sends when saving; secrets are separated out explicitly. */
export interface SaveConnectionInput {
  readonly id?: string;
  readonly name: string;
  readonly engine: EngineId;
  readonly folderId?: string | null;
  readonly labelColor?: string | null;
  readonly pinned?: boolean;
  readonly readOnly?: boolean;
  readonly rememberSecrets: boolean;
  readonly config: Omit<ConnectionConfig, 'password'>;
  /** Written to the keyring, never to the database. */
  readonly secrets?: Readonly<Record<string, string>>;
}
