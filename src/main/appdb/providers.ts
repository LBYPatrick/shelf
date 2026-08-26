import { randomUUID } from 'node:crypto';
import type { AiProvider, AiProviderInput } from '@shared/ai';
import type { AppDatabase } from './database';
import type { SecretStore } from '../secrets';

/**
 * The assistant's configured providers.
 *
 * A table rather than a blob in the settings store, for the same reason saved
 * connections have one: the key lives in the keyring under the provider's id,
 * and a row that can be deleted is what makes "delete this provider" reliably
 * delete its key too. A JSON array in a settings value has no delete hook and
 * leaves an orphan in the keychain every time an entry is removed.
 *
 * The key itself is never a column here. It goes through the same
 * `SecretStore` a database password does — encrypted by the OS — and the only
 * things that ever hold the plaintext are the keyring and the connection host.
 */

interface ProviderRow {
  id: string;
  name: string;
  driver: string;
  model: string;
  base_url: string | null;
  created_at: number;
}

/** The keyring owner for a provider, and the one key it holds. */
const owner = (id: string) => `ai:${id}`;
const API_KEY = 'apiKey';

export class ProviderRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly secrets: SecretStore
  ) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_provider (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        driver     TEXT NOT NULL,
        model      TEXT NOT NULL,
        base_url   TEXT,
        created_at INTEGER NOT NULL
      )
    `);
  }

  list(): AiProvider[] {
    const rows = this.db
      .prepare('SELECT * FROM ai_provider ORDER BY created_at')
      .all() as ProviderRow[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      driver: row.driver as AiProvider['driver'],
      model: row.model,
      ...(row.base_url ? { baseUrl: row.base_url } : {}),
      createdAt: row.created_at,
    }));
  }

  get(id: string): AiProvider | undefined {
    return this.list().find((provider) => provider.id === id);
  }

  save(input: AiProviderInput): AiProvider {
    const id = input.id ?? randomUUID();
    const existing = input.id ? this.get(input.id) : undefined;
    const createdAt = existing?.createdAt ?? Date.now();

    this.db
      .prepare(
        `INSERT INTO ai_provider (id, name, driver, model, base_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           driver = excluded.driver,
           model = excluded.model,
           base_url = excluded.base_url`
      )
      .run(
        id,
        input.name.trim(),
        input.driver,
        input.model.trim(),
        input.baseUrl ?? null,
        createdAt
      );

    /*
     * Absent means "leave what is stored", empty means "forget it".
     *
     * The distinction matters because the editor is allowed to show the key it
     * already holds — the same narrow exception the connection editor takes —
     * so a form submitted without touching that field must not be read as an
     * instruction to clear it.
     */
    if (input.apiKey !== undefined) {
      if (input.apiKey === '') this.secrets.clear(owner(id), API_KEY);
      else this.secrets.set(owner(id), API_KEY, input.apiKey);
    }

    return this.get(id)!;
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM ai_provider WHERE id = ?').run(id);
    // The row and its key go together, or the keychain accumulates entries for
    // providers that no longer exist and nothing will ever clean them up.
    this.secrets.clear(owner(id));
  }

  apiKey(id: string): string | undefined {
    return this.secrets.get(owner(id), API_KEY);
  }

  /** Whether a key is on file, without saying what it is. */
  hasKey(id: string): boolean {
    return this.apiKey(id) !== undefined;
  }
}
