import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import {
  APPDB_CHANNELS,
  type HistoryInput,
  type PrepareConnectionRequest,
  type SaveQueryInput,
} from '@shared/appdb';
import type { AiProviderInput } from '@shared/ai';
import { detectedDriverOf, detectedProvider } from '@shared/aiDrivers';
import type { SaveChatInput } from '@shared/appdb';
import { ChatRepository } from '../appdb/chats';
import { ProviderRepository } from '../appdb/providers';
import { StorageRepository } from '../appdb/storage';
import { JOBS_SUBDIR, type StorageCategoryId } from '@shared/storage';
import type { SaveConnectionInput } from '@shared/connections';
import type { ConnectionConfig } from '@drivers/types';
import type { ConnectionRepository } from '../appdb/connections';
import { QueryRepository } from '../appdb/queries';
import type { AppDatabase } from '../appdb/database';
import type { ConnectionHost } from '../host';
import type { SecretStore } from '../secrets';

/**
 * Bookkeeping the main process owns: saved connections, folders and settings.
 *
 * These deliberately do not go through the connection host. The host is for
 * database traffic and is restartable; losing it must not lose the user's saved
 * connections, and secrets must never travel further than they have to.
 */
export function registerAppDbHandlers(
  db: AppDatabase,
  connections: ConnectionRepository,
  secrets: SecretStore,
  host: ConnectionHost,
  sessionIdFor: (window: BrowserWindow) => string
): void {
  ipcMain.handle(APPDB_CHANNELS.listConnections, () => connections.list());
  ipcMain.handle(APPDB_CHANNELS.listFolders, () => connections.listFolders());

  ipcMain.handle(APPDB_CHANNELS.saveConnection, (_event, input: SaveConnectionInput) =>
    connections.save(input)
  );

  ipcMain.handle(APPDB_CHANNELS.removeConnection, (_event, id: string) => {
    connections.remove(id);
  });

  ipcMain.handle(APPDB_CHANNELS.markConnectionUsed, (_event, id: string) => {
    connections.markUsed(id);
  });

  ipcMain.handle(APPDB_CHANNELS.secretsAvailable, () => secrets.available);

  ipcMain.handle(APPDB_CHANNELS.revealSecrets, (_event, id: string) => {
    // Only what a form can edit, and only for a connection that exists.
    const config = connections.resolveConfig(id);
    return {
      ...(config.password ? { password: config.password } : {}),
      ...(config.ssh?.password ? { sshPassword: config.ssh.password } : {}),
      ...(config.ssh?.passphrase ? { sshPassphrase: config.ssh.passphrase } : {}),
    };
  });

  const queries = new QueryRepository(db);

  ipcMain.handle(APPDB_CHANNELS.recordHistory, (_event, entry: HistoryInput) =>
    queries.record(entry)
  );
  ipcMain.handle(APPDB_CHANNELS.listHistory, (_event, connectionId: string | null) =>
    queries.history(connectionId)
  );
  ipcMain.handle(APPDB_CHANNELS.clearHistory, (_event, connectionId: string | null) =>
    queries.clearHistory(connectionId)
  );
  ipcMain.handle(APPDB_CHANNELS.listSavedQueries, (_event, connectionId: string | null) =>
    queries.listSaved(connectionId)
  );
  ipcMain.handle(APPDB_CHANNELS.saveQuery, (_event, input: SaveQueryInput) =>
    queries.saveQuery({ ...input, connectionId: input.connectionId })
  );
  ipcMain.handle(APPDB_CHANNELS.removeSavedQuery, (_event, id: string) =>
    queries.removeSaved(id)
  );

  ipcMain.handle(
    APPDB_CHANNELS.prepareConnection,
    (event, request: PrepareConnectionRequest): string => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) throw new Error('No window for this request');

      let config: ConnectionConfig;

      if (request.kind === 'saved') {
        config = connections.resolveConfig(request.connectionId);
      } else {
        // A draft may leave the password field blank to mean "keep the one you
        // already have", which is the normal case when editing a saved
        // connection, so fall back to the keyring for anything not retyped.
        const stored = request.basedOn ? connections.resolveConfig(request.basedOn) : undefined;

        const password = request.secrets?.['password'] || stored?.password;
        const ssh = request.config.ssh
          ? {
              ...request.config.ssh,
              password: request.secrets?.['sshPassword'] || stored?.ssh?.password,
              passphrase: request.secrets?.['sshPassphrase'] || stored?.ssh?.passphrase,
            }
          : undefined;

        config = {
          ...request.config,
          ...(password ? { password } : {}),
          ...(ssh ? { ssh } : {}),
        };
      }

      const handle = randomUUID();
      host.stage(sessionIdFor(window), handle, config);
      return handle;
    }
  );

  const providers = new ProviderRepository(db, secrets);

  ipcMain.handle(APPDB_CHANNELS.listAiProviders, () => providers.list());
  ipcMain.handle(APPDB_CHANNELS.saveAiProvider, (_event, input: AiProviderInput) =>
    providers.save(input)
  );
  ipcMain.handle(APPDB_CHANNELS.removeAiProvider, (_event, id: string) => {
    providers.remove(id);
  });
  ipcMain.handle(
    APPDB_CHANNELS.revealAiKey,
    (_event, id: string) => providers.apiKey(id) ?? ''
  );

  ipcMain.handle(APPDB_CHANNELS.prepareAiProvider, (event, id: string): string => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error('No window for this request');

    /*
     * A detected provider has no row to look up. It is a program on this
     * machine that signs itself in, so the record is derived from the driver
     * rather than stored — and it has no key, which is the whole reason it can
     * be offered without being configured.
     */
    const detected = detectedDriverOf(id);
    const provider = detected ? detectedProvider(detected) : providers.get(id);
    if (!provider) throw new Error('That assistant provider no longer exists.');

    const handle = randomUUID();
    const apiKey = detected ? undefined : providers.apiKey(id);
    host.stageProvider(sessionIdFor(window), handle, provider, apiKey);
    return handle;
  });

  const chats = new ChatRepository(db);

  ipcMain.handle(APPDB_CHANNELS.listChats, (_event, connectionId: string | null) =>
    chats.list(connectionId)
  );
  ipcMain.handle(APPDB_CHANNELS.readChat, (_event, id: string) => chats.read(id));
  ipcMain.handle(APPDB_CHANNELS.saveChat, (_event, input: SaveChatInput) => chats.save(input));
  ipcMain.handle(APPDB_CHANNELS.renameChat, (_event, id: string, title: string) => {
    chats.rename(id, title);
  });
  ipcMain.handle(APPDB_CHANNELS.removeChat, (_event, id: string) => {
    chats.remove(id);
  });

  const readSetting = db.prepare('SELECT value FROM setting WHERE key = ?');
  const writeSetting = db.prepare(
    'INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );

  ipcMain.handle(APPDB_CHANNELS.getSetting, (_event, key: string, fallback: unknown) => {
    const row = readSetting.get(key) as { value: string } | undefined;
    if (!row) return fallback;
    try {
      return JSON.parse(row.value);
    } catch {
      return fallback;
    }
  });

  ipcMain.handle(APPDB_CHANNELS.setSetting, (_event, key: string, value: unknown) => {
    writeSetting.run(key, JSON.stringify(value));
  });

  /*
   * Storage, measured and emptied.
   *
   * `clearStorage` answers with the new figures rather than with nothing, so
   * the sheet redraws from what actually happened instead of from what it
   * assumed would happen. A clear that failed halfway is then visible in the
   * one place anybody would look.
   */
  const directory = app.getPath('userData');
  const storage = new StorageRepository(
    db,
    connections,
    providers,
    directory,
    join(directory, JOBS_SUBDIR)
  );

  ipcMain.handle(APPDB_CHANNELS.storageUsage, () => storage.usage());

  ipcMain.handle(APPDB_CHANNELS.clearStorage, (_event, categories: StorageCategoryId[]) => {
    storage.clear(categories);
    return storage.usage();
  });
}
