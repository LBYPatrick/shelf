import { randomUUID } from 'node:crypto';
import { BrowserWindow, Notification, app, ipcMain, nativeTheme } from 'electron';
import { platformIdFrom, type PlatformInfo } from '@shared/platform';
import { HOST_CHANNELS, WINDOW_CHANNELS, type Appearance } from '@shared/window';
import { ConnectionRepository } from './appdb/connections';
import { closeAppDatabase, openAppDatabase } from './appdb/database';
import { ConnectionHost } from './host';
import { registerAppDbHandlers } from './ipc/appdb';
import { registerDialogHandlers } from './ipc/dialogs';
import { registerUpdateHandlers } from './ipc/updates';
import { createSecretStore } from './secrets';
import { Updater } from './updates';
import { createMainWindow, setCompactMode } from './window';

const connectionHost = new ConnectionHost();

/*
 * One updater for the app, not one per window.
 *
 * The thing being updated is the app itself, so a second window looking at a
 * second copy of "is there a new version" would be two answers to a question
 * that has one. Built here rather than inside `whenReady` for the same reason
 * the host is: it holds no resources until something asks it to.
 */
const updater = new Updater();

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

  /*
   * A notice, on the desktop, but only while nobody is looking at the window.
   *
   * The in-app toast is quiet by design — it is a sentence in the corner of a
   * window you are already reading — and that is exactly wrong for the case it
   * matters most in: an import that finishes, or a connection that drops, while
   * the reader is in another application. The OS banner is the one thing that
   * reaches them there.
   *
   * The focus test is made here rather than in the renderer because it is the
   * only place it can be made without racing: an answer that travelled to the
   * renderer and a notification that travelled back would be describing a
   * moment that had already passed.
   *
   * Never under test. The suite runs with a window that is never shown, so
   * every toast would qualify — and each one would raise a real banner on the
   * machine running the tests.
   */
  ipcMain.on(WINDOW_CHANNELS.notify, (event, notice: { title: string; body: string }) => {
    if (process.env['SHELF_E2E']) return;
    if (!Notification.isSupported()) return;

    const window = senderWindow(event);
    if (window?.isFocused()) return;

    new Notification({ title: notice.title, body: notice.body }).show();
  });

  ipcMain.handle(WINDOW_CHANNELS.platformInfo, (): PlatformInfo => {
    const platform = platformIdFrom(process.platform);
    return {
      platform,
      nativeWindowControls: platform === 'macos',
      // Traffic lights sit at x=14 and are ~52px wide; the renderer keeps this
      // strip clear so nothing lands underneath them.
      windowControlsInset: platform === 'macos' ? 78 : 0,
      appVersion: __APP_VERSION__,
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

/*
 * Under test, stay out of the foreground entirely.
 *
 * Before `whenReady`, and that is the whole point of where this line sits. Done
 * inside the ready handler the icon is already in the dock by the time it runs,
 * so every launch put one there and took it away again a moment later — and a
 * suite is a hundred launches, run several times while someone is working at
 * the same desk. A flash per app is a flash nobody asked for.
 *
 * `LSUIElement` would be the packaged app's way of saying this; an unpackaged
 * Electron run has no `Info.plist` of its own to say it in, so it is said here.
 */
if (process.env['SHELF_E2E']) app.dock?.hide();

app.on('second-instance', focusExistingWindow);

app.whenReady().then(() => {
  const db = openAppDatabase();
  const secrets = createSecretStore(db);
  const connections = new ConnectionRepository(db, secrets);

  registerWindowHandlers();
  registerHostHandlers();
  registerAppDbHandlers(db, connections, secrets, connectionHost, sessionIdFor);
  registerDialogHandlers();
  registerUpdateHandlers(updater);

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
