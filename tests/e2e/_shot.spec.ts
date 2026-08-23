import { mkdir } from 'node:fs/promises';
import { test } from './fixtures';
import { openTable, typeQuery } from './helpers';

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
  await page
    .getByRole('button', { name: /new query/i })
    .first()
    .click();
  await typeQuery(page, 'select id, name from music.artist');
  await page.getByRole('button', { name: 'What Run performs' }).click();
  await page.getByRole('menuitem', { name: 'Dispatch' }).click();
  await page.getByRole('button', { name: 'Jobs' }).click();
  await settle(1500);
  await page.screenshot({ path: `${OUT}/06-jobs.png` });

  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await settle(600);
  await page.screenshot({ path: `${OUT}/07-jobs-filters.png` });

  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('shelf.appearance') ?? '{}');
    localStorage.setItem('shelf.appearance', JSON.stringify({ ...stored, mode: 'dark' }));
  });
  await page.reload();
  await settle(900);
  await page.screenshot({ path: `${OUT}/08-dark-start.png` });
});
