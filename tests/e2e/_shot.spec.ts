import { mkdir } from 'node:fs/promises';
import { test } from './fixtures';
import { newQueryTab, openTable, typeQuery } from './helpers';

/** Developer tool. Run with `pnpm shots`. */
const OUT = process.env['SHOT_DIR'] ?? 'test-results/shots';

test('capture the interface', async ({ page }) => {
  await mkdir(OUT, { recursive: true });
  const settle = (ms = 500) => page.waitForTimeout(ms);

  await settle();
  await page.screenshot({ path: `${OUT}/01-start-empty.png` });

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

  await page.screenshot({ path: `${OUT}/02-start-saved.png` });

  // Sample mode: the whole app, with no database at all.
  await page.getByRole('button', { name: /Sample database/ }).click();
  await page.locator('.strip').waitFor({ timeout: 20_000 });
  await settle(900);
  await page.screenshot({ path: `${OUT}/03-sample-workspace.png` });

  await openTable(page, 'album');
  await settle(900);
  await page.screenshot({ path: `${OUT}/04-sample-table.png` });

  await page.keyboard.press('ControlOrMeta+k');
  await page.getByPlaceholder(/Search tables/).fill('diagram');
  await page.keyboard.press('Enter');
  await settle(2500);
  await page.screenshot({ path: `${OUT}/05-sample-erd.png` });

  // The jobs rail: a card, and the questions it can be asked.
  await newQueryTab(page);
  await typeQuery(page, 'select id, name from music.artist');
  await page.getByRole('button', { name: 'What Run performs' }).click();
  await page.getByRole('menuitem', { name: 'Dispatch' }).click();
  await page.getByRole('button', { name: 'Jobs' }).click();
  await settle(1500);
  await page.screenshot({ path: `${OUT}/06-jobs.png` });

  // The drawer this used to open is gone; the conditions are chips, and the
  // popup that adds one is what is worth a frame.
  await page.getByRole('button', { name: 'Add a filter' }).first().click();
  await settle(600);
  await page.screenshot({ path: `${OUT}/07-jobs-filters.png` });
  await page.keyboard.press('Escape');
  await settle(300);

  // The keymap, in both of the ways it is edited.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Customise' }).click();
  await settle(700);
  await page.screenshot({ path: `${OUT}/08-shortcuts.png` });

  const sheet = page.getByRole('dialog').last();
  await sheet.getByRole('button', { name: 'Change the shortcut for New query tab' }).click();
  await settle(400);
  await page.screenshot({ path: `${OUT}/09-shortcuts-recording.png` });
  await page.keyboard.press('Escape');

  await sheet.getByRole('radio', { name: 'JSON' }).click();
  await settle(700);
  await page.screenshot({ path: `${OUT}/10-shortcuts-json.png` });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await settle(400);

  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('shelf.appearance') ?? '{}');
    localStorage.setItem('shelf.appearance', JSON.stringify({ ...stored, mode: 'dark' }));
  });
  await page.reload();
  await settle(900);
  await page.screenshot({ path: `${OUT}/11-dark-start.png` });
});
