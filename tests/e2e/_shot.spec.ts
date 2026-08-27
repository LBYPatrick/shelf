import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { test } from './fixtures';
import { newQueryTab, openTable, typeQuery } from './helpers';

/** Developer tool. Run with `pnpm shots`. */
const OUT = process.env['SHOT_DIR'] ?? 'test-results/shots';

/*
 * `SHELF_SHOW=1` captures the real window off the screen instead of the page.
 *
 * A page screenshot is everything the renderer drew and nothing else — which
 * leaves out the two things that make this a window rather than a web page.
 * The traffic lights are drawn by macOS, and the vibrancy is drawn by the
 * compositor *behind* the window, so neither exists in a surface the renderer
 * owns. `screencapture` over the window's own bounds takes what is actually on
 * the screen, blurred desktop and all.
 *
 * Exactly the window's bounds and no margin: the material showing through the
 * rail and the sidebar is the point, and a wider frame would put whatever is on
 * the developer's desktop into a picture bound for a public README.
 */
const FROM_SCREEN = Boolean(process.env['SHELF_SHOW']);

test('capture the interface', async ({ app, page }) => {
  await mkdir(OUT, { recursive: true });
  const settle = (ms = 500) => page.waitForTimeout(ms);

  if (FROM_SCREEN) {
    // A size worth looking at, and frontmost — a region capture takes whatever
    // is on screen there, including anything sitting over it.
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setBounds({ x: 120, y: 120, width: 1280, height: 820 });
      window?.focus();
    });
    // A beat before the first capture. The window has just been brought to the
    // front on somebody's real desktop, and the run needs them to be out of the
    // rectangle it is about to photograph.
    await page.waitForTimeout(5000);
  }

  const shot = async (name: string): Promise<void> => {
    if (!FROM_SCREEN) {
      await shot('${name}');
      return;
    }
    // Focused for every capture, not once at the start. Focus drifts over a
    // twenty second run, and an unfocused mac window greys its own traffic
    // lights — which reads as a screenshot of an app nobody is using.
    const at = await app.evaluate(({ app: electronApp, BrowserWindow }) => {
      // `steal` because a window focused inside a background app is still a
      // background window, and macOS greys an inactive window's traffic lights
      // — which reads as a screenshot of an app nobody is using.
      electronApp.focus({ steal: true });
      const window = BrowserWindow.getAllWindows()[0];
      window?.focus();
      return window?.getBounds();
    });
    await page.waitForTimeout(250);
    if (!at) throw new Error('no window to capture');
    execFileSync('screencapture', [
      '-x',
      '-R',
      `${at.x},${at.y},${at.width},${at.height}`,
      `${OUT}/${name}.png`,
    ]);
  };

  await settle();
  await shot('01-start-empty');

  // Two saved connections, so the grid and the sample panel are both in frame.
  for (const [engine, host] of [
    ['PostgreSQL', 'db.internal'],
    ['ScyllaDB', 'cluster.internal'],
  ] as const) {
    await page
      .getByRole('button', { name: /New connection/ })
      .first()
      .click();
    await page.getByRole('radio', { name: engine, exact: true }).click();
    await page.getByLabel('Host', { exact: true }).fill(host);
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await settle(400);
  }

  await shot('02-start-saved');

  // Sample mode: the whole app, with no database at all.
  await page.getByRole('button', { name: /Sample database/ }).click();
  await page.locator('.strip').waitFor({ timeout: 20_000 });
  await settle(900);
  await shot('03-sample-workspace');

  await openTable(page, 'album');
  await settle(900);
  await shot('04-sample-table');

  await page.keyboard.press('ControlOrMeta+k');
  await page.getByPlaceholder(/Search tables/).fill('diagram');
  await page.keyboard.press('Enter');
  await settle(2500);
  // The layout settles wherever it settles, and at 100% that is usually half
  // off the top of the pane. Fit is what a person presses next.
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await settle(900);
  await shot('05-sample-erd');

  // The jobs rail: a card, and the questions it can be asked.
  await newQueryTab(page);
  await typeQuery(page, 'select id, name from music.artist');
  await page.getByRole('button', { name: 'What Run performs' }).click();
  await page.getByRole('menuitem', { name: 'Dispatch' }).click();
  await page.getByRole('button', { name: 'Jobs' }).click();
  await settle(1500);
  await shot('06-jobs');

  // The drawer this used to open is gone; the conditions are chips, and the
  // popup that adds one is what is worth a frame.
  await page.getByRole('button', { name: 'Add a filter' }).first().click();
  await settle(600);
  await shot('07-jobs-filters');
  await page.keyboard.press('Escape');
  await settle(300);

  // The keymap, in both of the ways it is edited.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Customise' }).click();
  await settle(700);
  await shot('08-shortcuts');

  const sheet = page.getByRole('dialog').last();
  await sheet.getByRole('button', { name: 'Change the shortcut for New query tab' }).click();
  await settle(400);
  await shot('09-shortcuts-recording');
  await page.keyboard.press('Escape');

  await sheet.getByRole('radio', { name: 'JSON' }).click();
  await settle(700);
  await shot('10-shortcuts-json');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await settle(400);

  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('shelf.appearance') ?? '{}');
    localStorage.setItem('shelf.appearance', JSON.stringify({ ...stored, mode: 'dark' }));
  });
  await page.reload();
  await settle(900);
  await shot('11-dark-start');
});
