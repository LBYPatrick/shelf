import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { createConnection } from './helpers';

test('the window opens on a calm, single-purpose start screen', async ({ page }) => {
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Shelf' })).toBeVisible();
  await expect(page.getByLabel('Paste a connection URL or search')).toBeVisible();

  const theme = await page.evaluate(() => document.documentElement.dataset['theme']);
  expect(theme).toMatch(/^shelf-(light|dark)$/);
  expect(await page.evaluate(() => document.documentElement.dataset['density'])).toBe(
    'default'
  );
});

test('the accent derivation reaches the document as custom properties', async ({ page }) => {
  const read = (property: string) =>
    page.evaluate(
      (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
      property
    );

  for (const property of [
    '--color-primary',
    '--color-base-100',
    '--accent-subtle',
    '--accent-hue',
  ]) {
    expect(await read(property), property).not.toBe('');
  }
});

test('pasting a connection URL is recognised and fills the form', async ({ page }) => {
  await page
    .getByLabel('Paste a connection URL or search')
    .fill('postgres://sam:secret@db.internal:6432/orders');

  const offer = page.getByRole('button', { name: /Recognised/ });
  await expect(offer).toBeVisible();
  await offer.click();

  // Every field the URL carried is already filled in, so the user confirms
  // rather than retypes.
  await expect(page.getByLabel('Host')).toHaveValue('db.internal');
  await expect(page.getByLabel('Port')).toHaveValue('6432');
  await expect(page.getByLabel('User')).toHaveValue('sam');
  await expect(page.getByLabel('Database', { exact: true })).toHaveValue('orders');
  await expect(page.getByLabel('Name')).toHaveValue('db.internal/orders');
});

test('every engine is offered on equal terms', async ({ page }) => {
  await page
    .getByRole('button', { name: /New connection/ })
    .first()
    .click();
  await expect(page.getByRole('radio')).toHaveCount(9);

  // No tier markers, no upsell: the words that would signal a paid edition must
  // not appear anywhere.
  const text = (await page.locator('body').innerText()).toLowerCase();
  for (const word of ['upgrade', 'premium', 'trial', 'license', 'ultimate']) {
    expect(text).not.toContain(word);
  }
});

test('choosing an engine does not submit the form', async ({ page }) => {
  await page
    .getByRole('button', { name: /New connection/ })
    .first()
    .click();

  // A <button> defaults to type="submit". When the engine chips lacked an
  // explicit type, picking one submitted the form: it saved a junk connection
  // and closed the sheet before anything had been filled in.
  await page.getByRole('radio', { name: 'PostgreSQL', exact: true }).click();

  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Host', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Connect to / })).toHaveCount(0);
});

test('switching language translates the interface', async ({ page }) => {
  await page.getByRole('button', { name: /Sample database/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Settings', exact: true }).click();

  // The dialog is named by its own heading, so it stops answering to "Settings"
  // the moment the language changes — which is the point.
  const settings = page.getByRole('dialog');
  // A real listbox now, not a native select: open it and choose, which is what
  // a person does and what a native `selectOption` could never exercise.
  await settings.getByLabel('Language').click();
  // The list is drawn in the body rather than inside the control, so nothing
  // between the two can clip it — which also puts it outside the dialog.
  await page.getByRole('option', { name: '日本語' }).click();

  // By role, because the sections now carry a sentence each and one of them
  // mentions another section by name.
  await expect(settings.getByRole('heading', { name: '外観' })).toBeVisible();
  // Option labels are built at setup time unless they are computed; these used
  // to keep whichever language the component mounted in.
  await expect(settings.getByRole('radio', { name: 'ダーク' })).toBeVisible();
  // And it reaches the workspace behind the sheet, not just the sheet itself.
  await page.keyboard.press('Escape');
  await expect(page.getByText('何も開いていません')).toBeVisible();
  await expect(page.getByRole('button', { name: /テーブルを検索/ })).toBeVisible();

  // And it survives a reload, because the choice is persisted.
  await page.reload();
  await expect(page.getByText('サンプルデータベース')).toBeVisible({ timeout: 20_000 });
});

/*
 * Every overlay used to listen for Escape itself, at the window and in the
 * capture phase — and listeners on the same node in the same phase all run, so
 * one press dismissed the whole pile. A select inside a sheet took the sheet
 * with it.
 */
test('escape dismisses one overlay at a time, from the top', async ({ page }) => {
  await page.getByRole('button', { name: /Sample database/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: /settings/i }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();

  await sheet.locator('.select__trigger').first().click();
  const list = page.getByRole('listbox').first();
  await expect(list).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(sheet).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

/*
 * A form that will not show what it already holds makes changing a *port* an
 * act of remembering a password. It used to leave the field blank and explain,
 * in help text, that blank meant "keep the saved one" — a rule the reader has
 * to be told and then remember, and one that silently discards a password the
 * moment they type a single character and delete it again.
 */
test('editing a connection shows the password it saved', async ({ page }) => {
  await page
    .getByRole('button', { name: /New connection/ })
    .first()
    .click();
  await page.getByRole('radio', { name: 'PostgreSQL', exact: true }).click();
  await page.getByLabel('Host').fill('127.0.0.1');
  await page.getByLabel('Port').fill('55432');
  await page.getByLabel('User').fill('shelf');
  await page.getByRole('textbox', { name: 'Password' }).fill('hunter2');
  await page.getByRole('textbox', { name: 'Database' }).fill('shelf');
  await page.getByLabel('Name').fill('Reveal me');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await page
    .getByRole('button', { name: /Edit Reveal me/ })
    .first()
    .click();
  const field = page.getByRole('textbox', { name: 'Password' });
  await expect(field).toHaveValue('hunter2');
  // Masked until asked, and asked with one control rather than two.
  await expect(field).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(field).toHaveAttribute('type', 'text');
});

/*
 * Settings are one state with two views, and a file is the third. What is
 * asserted is that all three are the same state: the document shows what the
 * form holds, an imported one moves the form, and what is written out is what
 * comes back in.
 */
test('settings go out to a file and come back through the form', async ({ app, page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'shelf-settings-'));
  const target = join(directory, 'settings.json');

  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, target);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // The document view shows the live state rather than a copy of the defaults.
  await page.getByRole('radio', { name: 'JSON' }).click();
  await expect(page.locator('.monaco-editor').first()).toBeVisible();
  await expect(page.getByText('Valid JSON.')).toBeVisible();
  await expect(page.locator('.monaco-editor').first()).toContainText('shelf.settings');

  // Writing a file is a row in the visual pane now rather than a button in a
  // footer that stood over both views — the document view's own chrome is the
  // validity bar and Apply, and nothing else.
  await page.getByRole('radio', { name: 'Visual' }).click();
  await page.getByRole('button', { name: 'Export…' }).click();
  await expect
    .poll(async () => readFile(target, 'utf8').catch(() => ''), { timeout: 15_000 })
    .toContain('shelf.settings');

  // Edit the file the way a person would with an editor, and read it back in.
  const saved = JSON.parse(await readFile(target, 'utf8')) as {
    appearance: Record<string, unknown>;
    preferences: Record<string, unknown>;
  };
  saved.appearance['density'] = 'compact';
  saved.preferences['pageSize'] = 250;
  // A value no control could produce is dropped rather than written through.
  saved.appearance['mode'] = 'chartreuse';
  await writeFile(target, JSON.stringify(saved), 'utf8');

  await page.getByRole('button', { name: 'Import…' }).click();

  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset['density']))
    .toBe('compact');

  // The form is showing the same thing, because there is only one state.
  await expect(page.getByRole('radio', { name: 'Compact' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  // ...and the nonsense never landed.
  await expect(page.getByRole('radio', { name: 'System' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
});

/*
 * A connection document is the thing people commit and mail, so the assertion
 * that matters is as much about what is *not* in it: the password stays in the
 * keyring, and the file says so rather than leaving it to be discovered.
 */
test('a connection can be written to a file and read back', async ({ app, page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'shelf-preset-'));
  const target = join(directory, 'preset.json');

  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, target);

  await createConnection(page, {
    engine: 'SQLite',
    file: join(directory, 'p.db'),
    name: 'Portable',
    connect: false,
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();

  await page.getByRole('button', { name: 'Export Portable' }).click();

  await expect
    .poll(async () => readFile(target, 'utf8').catch(() => ''), { timeout: 15_000 })
    .toContain('Portable');

  const preset = JSON.parse(await readFile(target, 'utf8')) as {
    note: string;
    connections: { name: string }[];
  };
  expect(preset.connections).toHaveLength(1);
  expect(preset.note).toContain('keyring');
  expect(await readFile(target, 'utf8')).not.toContain('password');

  // Read it back: the same connection arrives again, from the file alone.
  await page.getByRole('button', { name: 'Delete Portable' }).click();
  await expect(page.getByRole('button', { name: 'Connect to Portable' })).toBeHidden();

  await page.getByRole('button', { name: /Import presets/ }).click();
  await expect(page.getByRole('button', { name: 'Connect to Portable' })).toBeVisible({
    timeout: 15_000,
  });
});
