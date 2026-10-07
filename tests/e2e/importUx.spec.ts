import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { createConnection, newQueryTab, typeQuery } from './helpers';

test('an unreadable replacement file invalidates the previous import preview', async ({
  app,
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'shelf-import-ux-'));
  const good = join(directory, 'good.csv');
  const bad = join(directory, 'bad.json');
  await writeFile(good, 'id,name\n1,Ada\n');
  await writeFile(bad, '{invalid json');
  await app.evaluate(
    ({ dialog }, paths) => {
      let index = 0;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths[index++]!] });
    },
    [good, bad]
  );
  await createConnection(page, {
    engine: 'SQLite',
    file: join(directory, 'data.db'),
    name: 'Import recovery',
  });
  await newQueryTab(page);
  await typeQuery(page, 'CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT);');
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('treeitem', { name: 'people', exact: true }).dblclick();
  await page.locator('.toolbar').getByRole('button', { name: 'Import', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: /Import into people/ });
  await sheet.getByRole('button', { name: 'Choose…' }).click();
  await expect(sheet).toContainText('1 row found');
  await expect(sheet.getByRole('button', { name: /^Import 1 row/ })).toBeEnabled();
  await sheet.getByRole('button', { name: 'Choose…' }).click();
  await expect(sheet.getByRole('alert')).toBeVisible();
  await expect(sheet.locator('.preview')).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: /^Import 0 rows/ })).toBeDisabled();
});
