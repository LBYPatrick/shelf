import { safeStorage } from 'electron';
import type { AppDatabase } from './appdb/database';

/**
 * Secret storage.
 *
 * Passwords, SSH passphrases and cloud credentials are encrypted by the
 * operating system — Keychain on macOS, DPAPI on Windows, libsecret on Linux —
 * so a copy of the application database is not a copy of the user's
 * credentials.
 *
 * The ciphertext is kept in our own table rather than as individual keychain
 * entries so that deleting a connection reliably deletes its secrets, and so a
 * connection with several secrets does not scatter a dozen entries through the
 * user's keychain.
 *
 * **Which means nothing of the reader's is *in* the keychain — only the key
 * that opens it.** That distinction is easy to lose, and it was lost: the
 * password field said "Stored in the system keychain, never in the app
 * database", which is exactly backwards, and the stored-data sheet offered to
 * remove passwords "from the system keychain" when what it removes is rows from
 * `shelf.db`. Both were found by somebody reading one screen against the other.
 * The strings that describe this are `connection.savePasswordHelp`,
 * `assistant.keyHelp`, `assistant.settingsDesc`, `storage.secretsGo` and
 * `start.exported`; a change to where these bytes live is a change to those.
 */

export interface SecretStore {
  readonly available: boolean;
  set(ownerId: string, key: string, value: string): void;
  get(ownerId: string, key: string): string | undefined;
  clear(ownerId: string, key?: string): void;
}

export function createSecretStore(db: AppDatabase): SecretStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS secret (
      owner_id  TEXT NOT NULL,
      key       TEXT NOT NULL,
      value     BLOB NOT NULL,
      PRIMARY KEY (owner_id, key)
    )
  `);

  const available = safeStorage.isEncryptionAvailable();

  const upsert = db.prepare(
    'INSERT INTO secret (owner_id, key, value) VALUES (?, ?, ?) ' +
      'ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value'
  );
  const select = db.prepare('SELECT value FROM secret WHERE owner_id = ? AND key = ?');
  const deleteOne = db.prepare('DELETE FROM secret WHERE owner_id = ? AND key = ?');
  const deleteAll = db.prepare('DELETE FROM secret WHERE owner_id = ?');

  return {
    available,

    set(ownerId, key, value) {
      if (!available) {
        // Storing a password in plaintext because the platform keyring is
        // missing would be a worse outcome than not remembering it. The user is
        // told, and is simply prompted each time instead.
        throw new Error(
          'The system keyring is unavailable, so passwords cannot be saved securely.'
        );
      }
      upsert.run(ownerId, key, safeStorage.encryptString(value));
    },

    get(ownerId, key) {
      if (!available) return undefined;
      const row = select.get(ownerId, key) as { value: Buffer } | undefined;
      if (!row) return undefined;

      try {
        return safeStorage.decryptString(row.value);
      } catch {
        // The keyring changed underneath us — a restored backup, a new machine.
        // The stored bytes are unreadable, so drop them and prompt instead.
        deleteOne.run(ownerId, key);
        return undefined;
      }
    },

    clear(ownerId, key) {
      if (key) deleteOne.run(ownerId, key);
      else deleteAll.run(ownerId);
    },
  };
}
