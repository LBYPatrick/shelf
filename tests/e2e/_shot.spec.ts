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
 */
const FROM_SCREEN = Boolean(process.env['SHELF_SHOW']);

/**
 * Desktop left around the window, in points.
 *
 * The window's shadow falls outside its own bounds, so a capture cut to the
 * bounds exactly loses the one thing that says this is sitting on a desktop
 * rather than pasted onto a page. Clamped to the display below: a region that
 * runs off the screen is a region `screencapture` will not take.
 */
const MARGIN = 56;

test('capture the interface', async ({ app, page }) => {
  await mkdir(OUT, { recursive: true });
  const settle = (ms = 500) => page.waitForTimeout(ms);

  if (FROM_SCREEN) {
    // Centred, and sized so the margin still lands on the screen — a laptop
    // panel is not much wider than the window this wants to be, and a region
    // that runs off the display comes back cropped on one side only.
    await app.evaluate(({ screen: displays, BrowserWindow }, margin) => {
      const target =
        displays.getAllDisplays().find((one) => one.internal) ?? displays.getPrimaryDisplay();
      const area = target.workArea;

      const width = Math.min(1280, area.width - margin * 2);
      const height = Math.min(820, area.height - margin * 2);

      const window = BrowserWindow.getAllWindows()[0];
      window?.setBounds({
        x: Math.round(area.x + (area.width - width) / 2),
        y: Math.round(area.y + (area.height - height) / 2),
        width,
        height,
      });
      window?.focus();
    }, MARGIN);
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

    // The display the window is actually on. Picking the internal one by name
    // is a guess that is wrong the moment there are two screens, and a region
    // clamped to a display the window is not on comes back as a sliver of it.
    const screen = await app.evaluate(
      ({ screen: displays }, where) => displays.getDisplayMatching(where).workArea,
      at
    );

    // Grown by the margin, then pulled back inside the display.
    const left = Math.max(screen.x, at.x - MARGIN);
    const top = Math.max(screen.y, at.y - MARGIN);
    const right = Math.min(screen.x + screen.width, at.x + at.width + MARGIN);
    const bottom = Math.min(screen.y + screen.height, at.y + at.height + MARGIN);

    console.log(
      `${name}: window ${at.width}x${at.height} at ${at.x},${at.y} -> region ` +
        `${right - left}x${bottom - top} at ${left},${top}`
    );

    execFileSync('screencapture', [
      '-x',
      '-R',
      `${left},${top},${right - left},${bottom - top}`,
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

  /*
   * The assistant, answering for real.
   *
   * Only on a screenshot run, and only because one is pointed at this machine:
   * `SHELF_SHOW` turns CLI detection back on, so whichever of Claude Code and
   * Codex is signed in here is the provider, and the answer in the picture is
   * an answer a model actually gave about the sample database. A mocked
   * transcript would be a drawing of the feature rather than the feature.
   */
  if (FROM_SCREEN) {
    // Back to the schema tree first. The jobs panel is where the previous shot
    // left the sidebar, and a picture of the assistant should have the database
    // beside it rather than a list of finished jobs.
    await page
      .getByRole('button', { name: 'Entities', exact: true })
      .first()
      .click()
      .catch(() => undefined);
    await settle(400);

    await page.keyboard.press('ControlOrMeta+Shift+a');
    await page.locator('.chat').waitFor({ timeout: 20_000 });
    await settle(600);

    const composer = page.getByPlaceholder('Ask about the data, or describe a query');
    if (await composer.isVisible().catch(() => false)) {
      await composer.fill('Which artists have the most tracks? Show me the top five.');
      await page.keyboard.press('Enter');

      // A real model over a real CLI. Two minutes is generous rather than
      // optimistic, and a run that does not get there leaves the shot out
      // instead of failing the capture of everything else.
      await page
        .locator('.rows__table')
        .first()
        .waitFor({ timeout: 120_000 })
        .catch(() => undefined);

      // And then until it has stopped writing. A turn caught mid-stream shows a
      // caret in the middle of a sentence and a progress bar under the
      // composer, which photographs as an app that has not finished loading.
      await page
        .getByRole('button', { name: 'Stop', exact: true })
        .waitFor({ state: 'hidden', timeout: 120_000 })
        .catch(() => undefined);
      await settle(1200);

      // Framed on the question and what came back. The transcript follows the
      // bottom while a turn is being written, which by the end is whatever the
      // model said last rather than the thing it was asked.
      await page.evaluate(() => {
        const scroller = document.querySelector('.chat__scroll');
        const question = document.querySelector('.chat__column [class*="ask"], .chat__column');
        if (scroller && question) scroller.scrollTop = 0;
      });
      await settle(700);
      await shot('12-assistant');
    }
  }

  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('shelf.appearance') ?? '{}');
    localStorage.setItem('shelf.appearance', JSON.stringify({ ...stored, mode: 'dark' }));
  });
  await page.reload();
  await settle(900);
  await shot('11-dark-start');
});
