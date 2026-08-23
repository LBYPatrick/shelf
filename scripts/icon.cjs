/**
 * Draws the icon.
 *
 * `resources/icon.svg` is the artwork; every raster the packagers want is made
 * from it here, so there is one drawing and no set of PNGs quietly drifting out
 * of date behind it. Electron does the rendering because Electron is already
 * here and it is the same engine that draws the app — no second browser to
 * install to turn a vector into a square.
 */
const { app, BrowserWindow, nativeImage } = require('electron');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const { tmpdir } = require('node:os');

const root = resolve(__dirname, '..');
/*
 * The artwork, where the artwork lives. The interface draws the same file — the
 * start screen's identity block and the About row are the same mark as the one
 * in the dock — but it gets there by being copied in at build time rather than
 * by there being two of it. See the icon rules in the Makefile.
 */
const source = join(root, 'resources', 'icon.svg');

/** The size everything else is cut from — electron-builder wants 1024. */
const MASTER = 1024;

const OUTPUTS = [
  [join(root, 'build', 'icon.png'), MASTER],
  // Small, to be looked at: an icon is judged in a dock and a menu, and every
  // detail that survives at 64 is one that was worth drawing.
  [join(root, 'build', 'icon-64.png'), 64],
];

/*
 * Drawn once and resized, rather than rendered once per size.
 *
 * A second transparent window fails to load at all on macOS — bare ERR_FAILED,
 * which reads as the drawing being wrong rather than the window being the
 * problem. One render is also the honest thing: every size is then the same
 * picture, and there is no size at which a rounding difference has quietly
 * moved a shelf.
 */
async function drawMaster(svg) {
  const window = new BrowserWindow({
    width: MASTER,
    height: MASTER,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { backgroundThrottling: false },
  });

  const page = `<!doctype html><meta charset="utf-8">
    <style>html,body{margin:0;background:transparent}
    svg{display:block;width:${MASTER}px;height:${MASTER}px}</style>${svg}`;

  const scratch = join(tmpdir(), 'shelf-icon.html');
  writeFileSync(scratch, page);
  await window.loadFile(scratch);

  const image = await window.webContents.capturePage();
  window.destroy();
  return image;
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    const master = await drawMaster(readFileSync(source, 'utf8'));

    /*
     * Resized to the size asked for, always — including the master.
     *
     * `capturePage` captures at the *display's* scale factor, so on this
     * machine a 1024 window produced a 2048 image and the log said 1024. An
     * icon that comes out at a different size depending on whose screen drew it
     * is not a build step, it is a coincidence.
     */
    for (const [path, size] of OUTPUTS) {
      mkdirSync(dirname(path), { recursive: true });
      const image = master.resize({ width: size, height: size, quality: 'best' });
      writeFileSync(path, image.toPNG());
      console.log(`  • drew ${size}×${size}  file=${path}`);
    }

    app.quit();
  } catch (error) {
    console.error(`  ✖ ${error instanceof Error ? error.message : error}`);
    app.exit(1);
  }
});

void nativeImage;
