import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { typeQuery } from './helpers';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Writing a file, which is the half of the export sheet nothing covered.
 *
 * Both existing export tests take the clipboard branch, and the file branch was
 * broken the whole time they were passing: the host read `cursor.fields` before
 * the cursor had answered a single batch, so the column list was empty, the CSV
 * header was a blank line and every row rendered as nothing. The export
 * reported the right row count and wrote a file of newlines.
 *
 * Driven end to end rather than against the writer alone, because the defect
 * lived in the seam between a driver's cursor and the writer — which is exactly
 * what a unit test of either side on its own cannot see.
 */
test('writes a file with a header and rows in it', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'shelf-e2e-'));
  const target = await mkdtemp(join(tmpdir(), 'shelf-export-'));

  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      args: [resolve(here, '../../out/main/index.js'), `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test', SHELF_E2E: '1' },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Answer the save dialog without showing it, and keep the name the app
    // suggested so the naming can be asserted too.
    await app.evaluate(({ dialog }, out) => {
      (globalThis as Record<string, unknown>)['__suggested'] = '';
      dialog.showSaveDialog = ((...args: unknown[]) => {
        const options = (args.length > 1 ? args[1] : args[0]) as { defaultPath?: string };
        const suggested = options?.defaultPath ?? '';
        (globalThis as Record<string, unknown>)['__suggested'] = suggested;
        const name = suggested.split('/').pop() || 'export.csv';
        return Promise.resolve({ canceled: false, filePath: `${out}/${name}` });
      }) as typeof dialog.showSaveDialog;
    }, target);

    await page.getByRole('button', { name: /Explore sample data/ }).click();
    await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });

    await page
      .getByRole('button', { name: /new query/i })
      .first()
      .click();
    await page.locator('.monaco-editor').first().click();
    await typeQuery(page, 'select id, name, country from music.artist');
    await page.keyboard.press('Meta+Enter');
    await expect(page.locator('.tabulator-row').first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await sheet.getByRole('radio', { name: 'File' }).click();
    await sheet.getByRole('radio', { name: 'CSV' }).click();
    await sheet.getByRole('button', { name: 'Export' }).click();

    await expect(page.locator('.notices [role="status"]')).toBeVisible({ timeout: 15_000 });

    const files = await readdir(target);
    expect(files, 'no file was written').toHaveLength(1);

    const text = await readFile(join(target, files[0]!), 'utf8');
    const lines = text.trim().split('\n');
    // The sample engine answers a SELECT with the whole table, so the header is
    // asserted for column *names* rather than for the projection.
    expect(lines[0], 'the header has no column names in it').toContain('name');
    expect(lines[0]).toContain('id');
    expect(lines.length, 'the file has no rows in it').toBeGreaterThan(1);
    expect(lines[1]).toMatch(/^\d+,/);

    /*
     * And the name it offered. A fixed `query-results.csv` collides with
     * itself, so a second export either overwrites the first or has to be
     * renamed by hand.
     */
    const suggested = await app.evaluate(
      () => (globalThis as Record<string, unknown>)['__suggested'] as string
    );
    expect(suggested).toMatch(/query-\d{8}-\d{6}-\d{6}\.csv$/);
  } finally {
    await app?.close();
    await rm(userDataDir, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});
