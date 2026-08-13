import { randomUUID } from 'node:crypto';
import type { ConnectionConfig } from '@drivers/types';
import type {
  ConnectionFolder,
  SaveConnectionInput,
  SavedConnection,
} from '@shared/connections';
import type { SecretStore } from '../secrets';
import type { AppDatabase } from './database';

/** Keyring keys a connection may hold. */
const SECRET_KEYS = ['password', 'sshPassword', 'sshPassphrase'] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

interface ConnectionRow {
  id: string;
  name: string;
  engine: string;
  folder_id: string | null;
  position: number;
  label_color: string | null;
  pinned: number;
  read_only: number;
  config: string;
  remember_secrets: number;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
}

function toSaved(row: ConnectionRow): SavedConnection {
  return {
    id: row.id,
    name: row.name,
    engine: row.engine as SavedConnection['engine'],
    folderId: row.folder_id,
    position: row.position,
    labelColor: row.label_color,
    pinned: row.pinned === 1,
    readOnly: row.read_only === 1,
    rememberSecrets: row.remember_secrets === 1,
    config: JSON.parse(row.config) as SavedConnection['config'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
  };
}

export class ConnectionRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly secrets: SecretStore
  ) {}

  list(): SavedConnection[] {
    const rows = this.db
      .prepare('SELECT * FROM connection ORDER BY pinned DESC, position ASC, name ASC')
      .all() as ConnectionRow[];
    return rows.map(toSaved);
  }

  listFolders(): ConnectionFolder[] {
    const rows = this.db
      .prepare(
        'SELECT id, name, parent_id, position FROM connection_folder ORDER BY position ASC'
      )
      .all() as { id: string; name: string; parent_id: string | null; position: number }[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parent_id,
      position: row.position,
    }));
  }

  get(id: string): SavedConnection | undefined {
    const row = this.db.prepare('SELECT * FROM connection WHERE id = ?').get(id) as
      ConnectionRow | undefined;
    return row ? toSaved(row) : undefined;
  }

  save(input: SaveConnectionInput): SavedConnection {
    const id = input.id ?? randomUUID();
    const now = Date.now();
    const existing = input.id ? this.get(input.id) : undefined;

    const position =
      existing?.position ??
      (
        this.db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM connection').get() as {
          p: number;
        }
      ).p + 1;

    this.db
      .prepare(
        `INSERT INTO connection (
           id, name, engine, folder_id, position, label_color, pinned, read_only,
           config, remember_secrets, created_at, updated_at, last_used_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           engine = excluded.engine,
           folder_id = excluded.folder_id,
           label_color = excluded.label_color,
           pinned = excluded.pinned,
           read_only = excluded.read_only,
           config = excluded.config,
           remember_secrets = excluded.remember_secrets,
           updated_at = excluded.updated_at`
      )
      .run(
        id,
        input.name,
        input.engine,
        input.folderId ?? null,
        position,
        input.labelColor ?? null,
        input.pinned ? 1 : 0,
        input.readOnly ? 1 : 0,
        JSON.stringify(input.config),
        input.rememberSecrets ? 1 : 0,
        existing?.createdAt ?? now,
        now,
        existing?.lastUsedAt ?? null
      );

    // "Don't remember" means the stored secrets are removed, not merely unused —
    // otherwise unticking the box would leave the old password on disk.
    if (!input.rememberSecrets) {
      this.secrets.clear(id);
    } else if (input.secrets) {
      for (const key of SECRET_KEYS) {
        const value = input.secrets[key];
        if (value === undefined) continue;
        if (value === '') this.secrets.clear(id, key);
        else this.secrets.set(id, key, value);
      }
    }

    return this.get(id)!;
  }

  remove(id: string): void {
    this.secrets.clear(id);
    this.db.prepare('DELETE FROM connection WHERE id = ?').run(id);
  }

  markUsed(id: string): void {
    this.db.prepare('UPDATE connection SET last_used_at = ? WHERE id = ?').run(Date.now(), id);
  }

  /**
   * Rebuilds the full connection configuration, merging the stored secrets back
   * in. Called only at the moment of connecting, in the main process, so
   * secrets never reach the renderer.
   */
  resolveConfig(id: string, overrides?: Partial<ConnectionConfig>): ConnectionConfig {
    const saved = this.get(id);
    if (!saved) throw new Error(`No such connection: ${id}`);

    const password = this.secrets.get(id, 'password');
    const sshPassword = this.secrets.get(id, 'sshPassword');
    const sshPassphrase = this.secrets.get(id, 'sshPassphrase');

    const ssh = saved.config.ssh
      ? {
          ...saved.config.ssh,
          ...(sshPassword !== undefined ? { password: sshPassword } : {}),
          ...(sshPassphrase !== undefined ? { passphrase: sshPassphrase } : {}),
        }
      : undefined;

    return {
      ...saved.config,
      ...(password !== undefined ? { password } : {}),
      ...(ssh ? { ssh } : {}),
      readOnly: saved.readOnly,
      ...overrides,
    };
  }
}
