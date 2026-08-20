import { randomUUID } from 'node:crypto';
import { BrowserWindow, app, ipcMain, nativeTheme } from 'electron';
import { platformIdFrom, type PlatformInfo } from '@shared/platform';
import { HOST_CHANNELS, WINDOW_CHANNELS, type Appearance } from '@shared/window';
import { ConnectionRepository } from './appdb/connections';
import { closeAppDatabase, openAppDatabase } from './appdb/database';
import { ConnectionHost } from './host';
import { registerAppDbHandlers } from './ipc/appdb';
import { registerDialogHandlers } from './ipc/dialogs';
import { createSecretStore } from './secrets';
import { createMainWindow, setCompactMode } from './window';

const connectionHost = new ConnectionHost();

/** One session per window, so windows never share a connection or transaction. */
const sessionIds = new WeakMap<BrowserWindow, string>();

function sessionIdFor(window: BrowserWindow): string {
  let sessionId = sessionIds.get(window);
  if (!sessionId) {
    sessionId = randomUUID();
    sessionIds.set(window, sessionId);
  }
  return sessionId;
}

// A second instance should focus the window we already have rather than open a
// competing one that would fight over the same app database.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function focusExistingWindow(): void {
  const [existing] = BrowserWindow.getAllWindows();
  if (!existing) return;
  if (existing.isMinimized()) existing.restore();
  existing.focus();
}

function registerWindowHandlers(): void {
  const senderWindow = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    BrowserWindow.fromWebContents(event.sender);

  ipcMain.on(WINDOW_CHANNELS.minimize, (event) => senderWindow(event)?.minimize());

  ipcMain.on(WINDOW_CHANNELS.toggleMaximize, (event) => {
    const window = senderWindow(event);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });

  ipcMain.on(WINDOW_CHANNELS.close, (event) => senderWindow(event)?.close());

  ipcMain.handle(
    WINDOW_CHANNELS.isMaximized,
    (event) => senderWindow(event)?.isMaximized() ?? false
  );

  /*
   * The window's material is painted by the OS, behind the page, so the OS is
   * the one that has to be told which appearance we are wearing. Setting a
   * `data-theme` attribute in the renderer changes nothing about it.
   *
   * Until this existed, a dark interface on a light desktop got the *light*
   * vibrancy material: a pale frosted rail, sidebar and status bar around a
   * near-black content pane, so the panels that are meant to recede were the
   * brightest things on screen.
   */
  ipcMain.on(WINDOW_CHANNELS.setAppearance, (_event, appearance: Appearance) => {
    nativeTheme.themeSource = appearance;
  });

  ipcMain.on(WINDOW_CHANNELS.setCompact, (event, compact: boolean) => {
    setCompactMode(senderWindow(event), compact);
  });

  ipcMain.handle(WINDOW_CHANNELS.platformInfo, (): PlatformInfo => {
    const platform = platformIdFrom(process.platform);
    return {
      platform,
      nativeWindowControls: platform === 'macos',
      // Traffic lights sit at x=14 and are ~52px wide; the renderer keeps this
      // strip clear so nothing lands underneath them.
      windowControlsInset: platform === 'macos' ? 78 : 0,
      appVersion: app.getVersion(),
      locale: app.getLocale(),
    };
  });
}

function registerHostHandlers(): void {
  ipcMain.on(HOST_CHANNELS.requestPort, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;

    connectionHost.attach(window, sessionIdFor(window));
  });
}

app.on('second-instance', focusExistingWindow);

app.whenReady().then(() => {
  // Under test, stay out of the foreground entirely: no dock icon, and no
  // becoming the active application when a window opens. The suites run on a
  // real desktop while someone is using it.
  if (process.env['SHELF_E2E']) app.dock?.hide();

  const db = openAppDatabase();
  const secrets = createSecretStore(db);
  const connections = new ConnectionRepository(db, secrets);

  registerWindowHandlers();
  registerHostHandlers();
  registerAppDbHandlers(db, connections, secrets, connectionHost, sessionIdFor);
  registerDialogHandlers();

  connectionHost.start();
  createMainWindow();

  // A host that has survived a minute of use is not in a crash loop; forgive
  // the earlier restarts so a much later failure gets a full budget again.
  setTimeout(() => connectionHost.markHealthy(), 60_000).unref?.();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', () => {
  connectionHost.dispose();
  closeAppDatabase();
});

app.on('window-all-closed', () => {
  // macOS keeps the app alive with no windows; every other platform quits.
  if (process.platform !== 'darwin') app.quit();
});
