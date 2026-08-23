import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, app, nativeImage, nativeTheme, screen, shell } from 'electron';
import { WINDOW_CHANNELS } from '@shared/window';

/**
 * Window sizing. The minimum is the point below which the three-region layout
 * stops being usable rather than an arbitrary round number: icon rail (48) +
 * a collapsed-but-legible sidebar (200) + a grid wide enough for a few columns.
 */
const DEFAULT_SIZE = { width: 1280, height: 820 };
const MIN_SIZE = { width: 880, height: 560 };

/**
 * The start screen's window.
 *
 * It is a panel, not a workspace: a title, a short list of databases and two
 * ways in. Given the whole screen it is mostly emptiness, so it gets a window
 * the size of what it contains — and it is not resizable, because there is
 * nothing in it that a larger window would show more of. The list scrolls.
 */
const COMPACT_SIZE = { width: 940, height: 580 };

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

/**
 * What the window was before it shrank, so it can be put back exactly, and
 * which of the two shapes it is currently in.
 *
 * The shape is *recorded* rather than read back off the window, and that is not
 * defensiveness. `isResizable()` was the obvious thing to ask and it lies here:
 * pinning a window by setting its minimum and maximum to the same size leaves
 * macOS reporting it as not resizable even after both constraints are cleared
 * again, so the window grew once and every later call decided it was already
 * compact and did nothing.
 *
 * Keyed by window rather than held in a module variable: there is one window
 * today, and a module variable is how that stops being true silently.
 */
const expanded = new WeakMap<BrowserWindow, Electron.Rectangle>();
const isCompact = new WeakMap<BrowserWindow, boolean>();

/**
 * Shrinks the window to the start screen's size, or restores it.
 *
 * The order is the substance of this. A window is clamped between its own
 * minimum and maximum at the moment it is resized, so both have to be out of
 * the way before `setSize` and put back afterwards — set the maximum to the
 * compact size while the window is still 1280 wide and the resize is a no-op.
 * `resizable` goes on before the resize and off after it for the same reason:
 * macOS ignores a resize on a window it has been told cannot be resized.
 */
export function setCompactMode(window: BrowserWindow | null, compact: boolean): void {
  if (!window || window.isDestroyed()) return;
  if ((isCompact.get(window) ?? true) === compact) return;

  if (window.isMaximized()) window.unmaximize();
  /*
   * And out of full screen before anything else, because a window that cannot
   * be resized cannot leave it.
   *
   * macOS will take a non-resizable window full screen and then refuse to bring
   * it back — the green button and the menu item both act on a size the window
   * has been told it may not have — so the start screen could be entered and
   * never exited. Compact mode declines to be full-screenable at all, and
   * leaves first if it already is.
   */
  if (window.isFullScreen()) window.setFullScreen(false);

  window.setMinimumSize(1, 1);
  window.setMaximumSize(0, 0);
  window.setResizable(true);

  if (compact) {
    if (!window.isFullScreen()) expanded.set(window, window.getBounds());

    window.setSize(COMPACT_SIZE.width, COMPACT_SIZE.height, false);
    window.center();
    window.setMinimumSize(COMPACT_SIZE.width, COMPACT_SIZE.height);
    window.setMaximumSize(COMPACT_SIZE.width, COMPACT_SIZE.height);
    window.setResizable(false);
    window.setFullScreenable(false);
  } else {
    /*
     * Centred when there is nothing to go back to.
     *
     * `setSize` grows a window from its top-left corner, so opening a
     * connection took the start screen — which was centred — and let it spill
     * down and to the right of where it had been. The window that arrives is
     * the same window, in the same place, at the size the work needs; a window
     * the reader has already moved or sized comes back exactly where they left
     * it, which is what the remembered bounds are for.
     */
    const previous = expanded.get(window);
    if (previous) {
      window.setBounds(previous, false);
    } else {
      window.setSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height, false);
      window.center();
    }

    window.setMinimumSize(MIN_SIZE.width, MIN_SIZE.height);
    window.setFullScreenable(true);
  }

  isCompact.set(window, compact);
}

/**
 * The app's own icon, in the two places that do not get one for free.
 *
 * A packaged app carries its icon in the bundle — macOS reads it from the
 * `.icns`, Windows from the executable, Linux from the desktop entry. Run
 * unpackaged, which is what `make dev` and `make preview` do, there is no
 * bundle: the dock and the task switcher show Electron's own atom, and the app
 * you are looking at is not obviously the app you are building.
 *
 * The file is the same 1024px render the packagers cut their sizes from, so
 * there is one drawing behind every place the icon appears.
 */
function applyDevelopmentIcon(window: BrowserWindow): void {
  // The packaged app has a better answer, and a test run has no dock to speak to.
  if (app.isPackaged || process.env['SHELF_E2E']) return;

  const path = join(app.getAppPath(), 'build', 'icon.png');
  if (!existsSync(path)) return;

  const image = nativeImage.createFromPath(path);
  if (image.isEmpty()) return;

  if (process.platform === 'darwin') app.dock?.setIcon(image);
  else window.setIcon(image);
}

export function createMainWindow(): BrowserWindow {
  /*
   * Opened compact, because the start screen is the first thing shown. Sizing
   * it to the workspace and shrinking once the renderer reports in would be a
   * visible flinch on every launch.
   */
  const window = new BrowserWindow({
    ...COMPACT_SIZE,
    minWidth: COMPACT_SIZE.width,
    minHeight: COMPACT_SIZE.height,
    maxWidth: COMPACT_SIZE.width,
    maxHeight: COMPACT_SIZE.height,
    resizable: false,
    // The start screen is a fixed size, and a window that cannot be resized
    // cannot come back out of full screen; see `setCompactMode`.
    fullscreenable: false,
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
      /*
       * A hidden window is still painted, but Chromium throttles a window it
       * believes nobody is looking at — which under test means animations and
       * layout settle late or not at all.
       */
      backgroundThrottling: false,
    },
  });

  /*
   * Under test the window is never shown at all.
   *
   * Electron paints a window that has not been shown (`paintWhenInitiallyHidden`
   * is on by default), and Playwright drives it and captures screenshots over
   * the debugging protocol, which needs neither an on-screen window nor OS
   * focus. So a suite run is invisible: no window appearing and disappearing on
   * the developer's screen, and nothing taking their keyboard mid-sentence.
   */
  isCompact.set(window, true);

  applyDevelopmentIcon(window);

  window.once('ready-to-show', () => {
    if (!process.env['SHELF_E2E']) window.show();
  });

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
