import { contextBridge, ipcRenderer } from 'electron';
import type { PlatformInfo } from '@shared/platform';
import {
  APPDB_CHANNELS,
  type AppDbApi,
  type HistoryInput,
  type PrepareConnectionRequest,
  type SaveQueryInput,
} from '@shared/appdb';
import type { SaveConnectionInput } from '@shared/connections';
import {
  DIALOG_CHANNELS,
  HOST_CHANNELS,
  WINDOW_CHANNELS,
  type Appearance,
  type DialogApi,
  type HostBridge,
  type WindowApi,
} from '@shared/window';

/**
 * The renderer's entire view of the outside world. Nothing else is exposed:
 * no Node globals, no `require`, no direct `ipcRenderer`.
 */
const windowApi: WindowApi = {
  minimize: () => ipcRenderer.send(WINDOW_CHANNELS.minimize),
  toggleMaximize: () => ipcRenderer.send(WINDOW_CHANNELS.toggleMaximize),
  close: () => ipcRenderer.send(WINDOW_CHANNELS.close),
  isMaximized: () => ipcRenderer.invoke(WINDOW_CHANNELS.isMaximized) as Promise<boolean>,
  setAppearance: (appearance: Appearance) =>
    ipcRenderer.send(WINDOW_CHANNELS.setAppearance, appearance),
  onMaximizedChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) =>
      listener(maximized);
    ipcRenderer.on(WINDOW_CHANNELS.maximizedChanged, handler);
    return () => ipcRenderer.off(WINDOW_CHANNELS.maximizedChanged, handler);
  },
};

/**
 * A MessagePort cannot be handed across the context bridge, so the port arrives
 * over IPC here and is re-posted into the page with `window.postMessage`, which
 * *can* transfer it. The renderer picks it up from its own message listener.
 */
ipcRenderer.on(HOST_CHANNELS.port, (event, payload: { sessionId: string }) => {
  window.postMessage({ type: HOST_CHANNELS.port, sessionId: payload.sessionId }, '*', [
    event.ports[0]!,
  ]);
});

const hostBridge: HostBridge = {
  requestPort: () => ipcRenderer.send(HOST_CHANNELS.requestPort),
  onRestarted: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(HOST_CHANNELS.restarted, handler);
    return () => ipcRenderer.off(HOST_CHANNELS.restarted, handler);
  },
  onUnavailable: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(HOST_CHANNELS.unavailable, handler);
    return () => ipcRenderer.off(HOST_CHANNELS.unavailable, handler);
  },
};

const appDb: AppDbApi = {
  listConnections: () => ipcRenderer.invoke(APPDB_CHANNELS.listConnections),
  listFolders: () => ipcRenderer.invoke(APPDB_CHANNELS.listFolders),
  saveConnection: (input: SaveConnectionInput) =>
    ipcRenderer.invoke(APPDB_CHANNELS.saveConnection, input),
  removeConnection: (id: string) => ipcRenderer.invoke(APPDB_CHANNELS.removeConnection, id),
  markConnectionUsed: (id: string) => ipcRenderer.invoke(APPDB_CHANNELS.markConnectionUsed, id),
  prepareConnection: (request: PrepareConnectionRequest) =>
    ipcRenderer.invoke(APPDB_CHANNELS.prepareConnection, request),
  secretsAvailable: () => ipcRenderer.invoke(APPDB_CHANNELS.secretsAvailable),
  recordHistory: (entry: HistoryInput) =>
    ipcRenderer.invoke(APPDB_CHANNELS.recordHistory, entry),
  listHistory: (connectionId: string | null) =>
    ipcRenderer.invoke(APPDB_CHANNELS.listHistory, connectionId),
  clearHistory: (connectionId: string | null) =>
    ipcRenderer.invoke(APPDB_CHANNELS.clearHistory, connectionId),
  listSavedQueries: (connectionId: string | null) =>
    ipcRenderer.invoke(APPDB_CHANNELS.listSavedQueries, connectionId),
  saveQuery: (input: SaveQueryInput) => ipcRenderer.invoke(APPDB_CHANNELS.saveQuery, input),
  removeSavedQuery: (id: string) => ipcRenderer.invoke(APPDB_CHANNELS.removeSavedQuery, id),
  getSetting: (key: string, fallback: unknown) =>
    ipcRenderer.invoke(APPDB_CHANNELS.getSetting, key, fallback),
  setSetting: (key: string, value: unknown) =>
    ipcRenderer.invoke(APPDB_CHANNELS.setSetting, key, value),
};

const dialogs: DialogApi = {
  openFile: (options) => ipcRenderer.invoke(DIALOG_CHANNELS.openFile, options),
  saveFile: (options) => ipcRenderer.invoke(DIALOG_CHANNELS.saveFile, options),
};

const shelf = {
  window: windowApi,
  host: hostBridge,
  db: appDb,
  dialogs,
  platformInfo: () => ipcRenderer.invoke(WINDOW_CHANNELS.platformInfo) as Promise<PlatformInfo>,
};

export type ShelfApi = typeof shelf;

contextBridge.exposeInMainWorld('shelf', shelf);
