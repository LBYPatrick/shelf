import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { createConnection } from './helpers';

test('validates ports and exposes socket and URL methods', async ({ page }) => {
  await page
    .getByRole('button', { name: /New connection/ })
    .first()
    .click();
  await page.getByRole('radio', { name: 'PostgreSQL', exact: true }).click();
  await page.getByLabel('Port', { exact: true }).fill('70000');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(page.getByText('Use a port between 1 and 65535.')).toBeVisible();
  await page.getByRole('radio', { name: 'Socket', exact: true }).click();
  await page.getByLabel('Socket path').fill('/tmp/postgres');
  await page.getByLabel('Name', { exact: true }).fill('Socket database');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const socket = await page.evaluate(async () => (await window.shelf.db.listConnections())[0]);
  expect(socket?.config.socketPath).toBe('/tmp/postgres');
  expect(socket?.config.port).toBeUndefined();
  await page
    .getByRole('button', { name: /New connection/ })
    .first()
    .click();
  await page.getByRole('radio', { name: 'MongoDB', exact: true }).click();
  await page.getByRole('radio', { name: 'Connection URL', exact: true }).click();
  await page.getByLabel('Connection URL', { exact: true }).fill('mongodb://localhost/test');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const mongo = await page.evaluate(async () =>
    (await window.shelf.db.listConnections()).find((entry) => entry.engine === 'mongodb')
  );
  expect(mongo?.config.url).toBe('mongodb://localhost/test');
  expect(mongo?.config.host).toBeUndefined();
});

test('Escape preserves a changed draft until discard is explicit', async ({ page }) => {
  await page
    .getByRole('button', { name: /New connection/ })
    .first()
    .click();
  await page.getByRole('radio', { name: 'PostgreSQL', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Unsaved');
  await page.keyboard.press('Escape');
  await expect(page.getByText('Discard your changes?')).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Unsaved');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.shelf.db.listConnections())).toHaveLength(0);
});

test('failed tests persist in the editor and clear when the details change', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: /New connection/ })
    .first()
    .click();
  await page.getByRole('radio', { name: 'SQLite', exact: true }).click();
  await page.getByLabel('Database file').fill('/does/not/exist/shelf.db');
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(page.locator('.feedback--error')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Database file').fill('/tmp/a-different-file.db');
  await expect(page.locator('.feedback')).toHaveCount(0);
});

test('manages and edits saved connections without disconnecting the workspace', async ({
  page,
}) => {
  const file = join(await mkdtemp(join(tmpdir(), 'shelf-ux-')), 'keep.db');
  await createConnection(page, { engine: 'SQLite', file, name: 'Keep open' });
  await page
    .getByRole('button', { name: /Keep open/ })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Manage connections', exact: true }).click();
  const library = page.getByRole('dialog', { name: 'Manage connections', exact: true });
  await expect(library).toBeVisible();
  await expect(page.locator('.strip')).toBeVisible();
  await library.getByRole('button', { name: 'Edit Keep open', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Renamed');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(library.getByText('Renamed', { exact: true })).toBeVisible();
  await library.getByRole('button', { name: 'Delete Renamed', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Remove Renamed?' })).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Remove Renamed?' })
    .getByRole('button', { name: 'Cancel' })
    .click();
  expect(await page.evaluate(() => window.shelf.db.listConnections())).toHaveLength(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.strip')).toBeVisible();
});

test('clearing a saved password removes it instead of silently keeping it', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: /New connection/ })
    .first()
    .click();
  await page.getByRole('radio', { name: 'PostgreSQL', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Clear credentials');
  await page.getByLabel('Password', { exact: true }).fill('remove-me');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Clear credentials', exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('remove-me');
  await page.getByLabel('Password', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const secrets = await page.evaluate(async () => {
    const connection = (await window.shelf.db.listConnections())[0]!;
    return window.shelf.db.revealSecrets(connection.id);
  });
  expect(secrets['password']).toBeUndefined();
});

test('preserves unreadable credentials until their replacement is explicit', async ({
  app,
  page,
}) => {
  const saved = await page.evaluate(() =>
    window.shelf.db.saveConnection({
      name: 'Credential recovery',
      engine: 'postgres',
      rememberSecrets: true,
      config: { engine: 'postgres', host: 'localhost', port: 5432, username: 'reader' },
    })
  );
  await app.evaluate(({ app }, id) => {
    const Database = process
      .getBuiltinModule('module')
      .createRequire(`${process.cwd()}/package.json`)('better-sqlite3');
    const db = new Database(`${app.getPath('userData')}/shelf.db`);
    db.prepare('INSERT INTO secret (owner_id, key, value) VALUES (?, ?, ?)').run(
      id,
      'password',
      Buffer.from('invalid-test-ciphertext')
    );
    db.close();
  }, saved.id);
  await page.reload();
  await page.getByRole('button', { name: 'Edit Credential recovery', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(page.locator('.credential-recovery')).toContainText('could not decrypt');
  expect(
    await app.evaluate(({ app }, id) => {
      const Database = process
        .getBuiltinModule('module')
        .createRequire(`${process.cwd()}/package.json`)('better-sqlite3');
      const db = new Database(`${app.getPath('userData')}/shelf.db`, { readonly: true });
      const row = db
        .prepare('SELECT value FROM secret WHERE owner_id=? AND key=?')
        .get(id, 'password');
      db.close();
      return row.value.toString() === 'invalid-test-ciphertext';
    }, saved.id)
  ).toBe(true);
  await page.getByRole('button', { name: 'Re-enter credentials', exact: true }).click();
  await page.getByLabel('Password', { exact: true }).fill('replacement');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  const handle = await page.evaluate(
    ({ id, config }) =>
      window.shelf.db.prepareConnection({
        kind: 'draft',
        basedOn: id,
        config,
        secrets: {
          password: 'replacement',
          sshPassword: '',
          sshPassphrase: '',
          proxyPassword: '',
        },
      }),
    saved
  );
  expect(handle).toBeTruthy();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect(
    await page.evaluate((id) => window.shelf.db.revealSecrets(id), saved.id)
  ).toMatchObject({ password: 'replacement' });
});
