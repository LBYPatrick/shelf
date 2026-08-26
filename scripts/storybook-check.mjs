import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from '@playwright/test';

/**
 * Every story, opened once, checked for an exception.
 *
 * A storybook that *builds* is not a storybook that works. A story whose setup
 * reads a store that is not seeded, or calls a bridge method the mock does not
 * have, compiles perfectly and then shows an error page to whoever opens it —
 * and nobody opens two hundred stories by hand. The first run of this found
 * twelve, including a mock that had fallen a feature behind the preload script.
 *
 * Three ways a story can fail, and all three count:
 *
 *   - it throws, which the page reports;
 *   - Storybook catches the throw and shows its own error page;
 *   - it renders *nothing*, which is as broken as either and is the only one
 *     you cannot see in a log.
 *
 * The "rendered nothing" check looks at the whole document rather than the
 * story's own container: half the surfaces in this app are `Teleport`ed — every
 * sheet, the context menu, the toasts, the hover tip — and a check scoped to
 * the container reports that a perfectly good modal drew nothing at all.
 *
 * Run it against a built storybook: `make storybook-check`.
 */

const OUT = 'out/storybook';
const PORT = 6099;

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

/** A static server, so the check needs nothing installed beyond the repo. */
const server = createServer(async (request, response) => {
  const path = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/');
  // Normalised and re-rooted: a request for `../../etc/passwd` resolves inside
  // the output directory or not at all.
  const file = join(OUT, normalize(path === '/' ? '/index.html' : path));

  try {
    const info = await stat(file);
    const target = info.isDirectory() ? join(file, 'index.html') : file;
    response.writeHead(200, {
      'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
    });
    response.end(await readFile(target));
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

const index = JSON.parse(readFileSync(`${OUT}/index.json`, 'utf8'));
const ids = Object.values(index.entries)
  .filter((entry) => entry.type === 'story')
  .map((entry) => entry.id);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const broken = [];

for (const id of ids) {
  const errors = [];
  const onError = (error) => errors.push(error.message);
  page.on('pageerror', onError);

  try {
    await page.goto(`http://127.0.0.1:${PORT}/iframe.html?id=${id}&viewMode=story`, {
      waitUntil: 'load',
      timeout: 20_000,
    });
    // Long enough for the mock bridge's own latency, which is deliberate: a
    // story that only renders once its data arrives has to be given the chance.
    await page.waitForTimeout(400);

    const overlay = await page
      .locator('#error-message')
      .first()
      .innerText({ timeout: 500 })
      .catch(() => '');

    const drawn = await page.evaluate(() => {
      const text = (document.body.textContent ?? '').trim().length;
      const shapes = document.body.querySelectorAll(
        'svg, canvas, input, textarea, button'
      ).length;
      return text + shapes;
    });

    if (errors.length > 0) broken.push({ id, why: errors[0] });
    else if (overlay) broken.push({ id, why: overlay.split('\n')[0] });
    else if (drawn === 0) broken.push({ id, why: 'rendered nothing' });
  } catch (error) {
    broken.push({ id, why: String(error).slice(0, 140) });
  }

  page.off('pageerror', onError);
}

await browser.close();
server.close();

console.log(`${ids.length} stories, ${broken.length} broken`);
for (const entry of broken) console.log(`  ${entry.id} — ${entry.why.slice(0, 150)}`);

process.exit(broken.length === 0 ? 0 : 1);
