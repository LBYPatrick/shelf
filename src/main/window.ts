import { join } from 'node:path';
import { BrowserWindow, app, nativeTheme, screen, shell } from 'electron';
import { WINDOW_CHANNELS } from '@shared/window';

/**
 * Window sizing. The minimum is the point below which the three-region layout
 * stops being usable rather than an arbitrary round number: icon rail (48) +
 * a collapsed-but-legible sidebar (200) + a grid wide enough for a few columns.
 */
const DEFAULT_SIZE = { width: 1280, height: 820 };
const MIN_SIZE = { width: 880, height: 560 };

/**
 * Translucency is a per-platform capability, not a style choice we can apply
 * uniformly. macOS gives us real behind-window vibrancy; Windows 11 gives us
 * acrylic; most Linux compositors give us neither, so there we stay opaque and
 * let the renderer's own material layer carry the look.
 */
function translucencyOptions(): Electron.BrowserWindowConstructorOptions {
  if (process.platform === 'darwin') {
    return {
      // `under-window` samples the desktop behind the window rather than the
      // window's own content, which is what makes the glass pick up the
      // wallpaper's colour and shift as the window moves. The sidebar-specific
      // materials look flatter here because they are tuned for a panel sitting
      // against an opaque sibling, which is the arrangement we build in CSS
      // instead.
      vibrancy: 'under-window',
      // Keep the material lit when the app is in the background; the default
      // drains it to grey the moment focus leaves, which reads as the window
      // having been disabled.
      visualEffectState: 'active',
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 14 },
      // Vibrancy needs the window itself to stay opaque — `transparent: true`
      // disables the effect and gives an unblurred hole instead.
      transparent: false,
    };
  }

  if (process.platform === 'win32') {
    return {
      frame: false,
      backgroundMaterial: 'acrylic',
    };
  }

  return { frame: false };
}

/**
 * Where a test window opens.
 *
 * The end-to-end suites drive a real window on a real desktop — someone's
 * actual screen, while they are using it. Left alone, every run opens on the
 * display they are working on and steals the keyboard as it does. So under test
 * the window goes to the built-in display and stays out of the way; Playwright
 * drives it over the debugging protocol and never needs it focused.
 */
function testPlacement(): Electron.BrowserWindowConstructorOptions {
  if (!process.env['SHELF_E2E']) return {};

  const displays = screen.getAllDisplays();
  // `internal` is the laptop panel. If the runner has no built-in display —
  // CI, a headless mac — fall back to the primary one rather than guessing.
  const target = displays.find((display) => display.internal) ?? screen.getPrimaryDisplay();

  return {
    x: target.workArea.x + 40,
    y: target.workArea.y + 40,
    // Keeps the window out of the window-cycling order it would otherwise join
    // on every run.
    skipTaskbar: true,
  };
}

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...DEFAULT_SIZE,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    // Painted behind the renderer while it boots, so the first frame is the
    // right colour rather than a white flash.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#00000000' : '#00000000',
    ...translucencyOptions(),
    ...testPlacement(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  // `showInactive` presents the window without activating the app, so a test
  // run does not pull focus out of whatever the user is typing into.
  window.once('ready-to-show', () =>
    process.env['SHELF_E2E'] ? window.showInactive() : window.show()
  );

  const notifyMaximized = () =>
    window.webContents.send(WINDOW_CHANNELS.maximizedChanged, window.isMaximized());
  window.on('maximize', notifyMaximized);
  window.on('unmaximize', notifyMaximized);

  // Anything that is not our own page opens in the user's browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
}
