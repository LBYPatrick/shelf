import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { createConnection, withClipboard } from './helpers';

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
/**
 * The engine is chosen once, and then it is a row.
 *
 * Nine marks in two wrapping rows was the loudest thing on the sheet and it was
 * there on every visit — including the ones where somebody came to change a
 * port. It is the whole content while nothing is chosen, which is the honest
 * first step of a new connection, and one line afterwards.
 */
test('the engine picker collapses once an engine is chosen', async ({ page }) => {
  await page
    .getByRole('button', { name: /New connection/ })
    .first()
    .click();

  // Nothing chosen: the grid is the content, and it is how the choice is made.
  await expect(page.getByRole('radio', { name: 'PostgreSQL', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'PostgreSQL', exact: true }).click();

  // Chosen: one row that names it, and the grid is gone rather than merely
  // scrolled past.
  await expect(page.locator('.engine-row__name')).toHaveText('PostgreSQL');
  await expect(page.getByRole('radio', { name: 'PostgreSQL', exact: true })).toHaveCount(0);
  // And the fields it was hiding are the ones that matter now.
  await expect(page.getByLabel('Host')).toBeVisible();

  // Changing it is one press, and choosing again settles it again.
  await page.getByRole('button', { name: 'Change' }).click();
  await expect(page.getByRole('radio', { name: 'MySQL', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'MySQL', exact: true }).click();
  await expect(page.locator('.engine-row__name')).toHaveText('MySQL');
});

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
  await expect(page.getByRole('dialog')).toHaveCount(0);

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
    keymap: Record<string, string[]>;
  };
  saved.appearance['density'] = 'compact';
  saved.preferences['pageSize'] = 250;
  // The two newest configurable things travel with the rest, or an export is a
  // partial copy that says nothing about what it left behind.
  saved.appearance['syntax'] = { light: 'nord', dark: 'nord', sync: true };
  saved.keymap = { 'tab.new': ['mod+shift+n'] };
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

  // The colour scheme reached the document root, and the keymap reached the
  // editor that draws it.
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--syntax-keyword').trim()
      )
    )
    .toBe('#5e81ac');

  await page.getByRole('button', { name: 'Customise' }).click();
  await expect(page.getByRole('dialog').last().getByText('⌘⇧N')).toBeVisible();
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
  // Two ways out now — a file, or the clipboard. This test is about the file.
  await page.getByRole('menuitem', { name: 'Save to a file…' }).click();

  await expect
    .poll(async () => readFile(target, 'utf8').catch(() => ''), { timeout: 15_000 })
    .toContain('Portable');

  const preset = JSON.parse(await readFile(target, 'utf8')) as {
    note: string;
    connections: { name: string }[];
  };
  expect(preset.connections).toHaveLength(1);

  // A SQLite file has no credential to carry, so the document says as much
  // rather than claiming an empty `secrets` is one.
  expect(preset.note).toContain('No passwords');
  expect(preset.connections[0]).not.toHaveProperty('secrets');

  // Read it back: the same connection arrives again, from the file alone.
  await page.getByRole('button', { name: 'Delete Portable' }).click();
  await expect(page.getByRole('button', { name: 'Connect to Portable' })).toBeHidden();

  await page.getByRole('button', { name: /Import presets/ }).click();
  await expect(page.getByRole('button', { name: 'Connect to Portable' })).toBeVisible({
    timeout: 15_000,
  });
});

/*
 * The point of a preset is that it moves a connection to another machine, and
 * one that arrives needing a password remembered is half a move. So the
 * password goes in the file, and this is the assertion that it does — and that
 * it comes back, rather than being written and then dropped on the way in.
 */
/**
 * The other way out of the same document.
 *
 * A file is how a connection moves to another machine; the clipboard is how it
 * gets into a message to a colleague, which is the more likely of the two when
 * somebody wants to *share* rather than to back up.
 */
test('a connection can be copied to the clipboard', async ({ page }) => {
  await createConnection(page, {
    engine: 'SQLite',
    file: join(await mkdtemp(join(tmpdir(), 'shelf-copy-')), 'copy.db'),
    name: 'Copyable',
    connect: false,
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();

  const document = await withClipboard(async () => {
    await page.getByRole('button', { name: 'Export Copyable' }).click();
    await page.getByRole('menuitem', { name: 'Copy to clipboard' }).click();
    await expect(page.locator('.notices [role="status"]')).toContainText('clipboard');
    return page.evaluate(() => navigator.clipboard.readText());
  });

  // The same document the file gets, not a summary of it.
  const parsed = JSON.parse(document) as { connections: { name: string }[] };
  expect(parsed.connections.map((one) => one.name)).toContain('Copyable');
});

test('a connection carries its password through the file', async ({ app, page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'shelf-secret-'));
  const target = join(directory, 'preset.json');

  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, target);

  await page
    .getByRole('button', { name: /New connection/ })
    .first()
    .click();
  await page.getByRole('radio', { name: 'PostgreSQL', exact: true }).click();
  await page.getByLabel('Host', { exact: true }).fill('db.internal');
  await page.getByLabel('Name').fill('WithSecret');
  await page.getByLabel('Password', { exact: true }).fill('hunter2');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();

  await page.getByRole('button', { name: 'Export WithSecret' }).click();
  // Two ways out now — a file, or the clipboard. This test is about the file.
  await page.getByRole('menuitem', { name: 'Save to a file…' }).click();

  await expect
    .poll(async () => readFile(target, 'utf8').catch(() => ''), { timeout: 15_000 })
    .toContain('WithSecret');

  const document = JSON.parse(await readFile(target, 'utf8')) as {
    note: string;
    connections: { secrets?: Record<string, string> }[];
  };
  expect(document.connections[0]?.secrets?.['password']).toBe('hunter2');
  expect(document.note).toContain('plain text');

  // And back again, from the file alone.
  await page.getByRole('button', { name: 'Delete WithSecret' }).click();
  await expect(page.getByRole('button', { name: 'Connect to WithSecret' })).toBeHidden();

  await page.getByRole('button', { name: /Import presets/ }).click();
  await expect(page.getByRole('button', { name: 'Connect to WithSecret' })).toBeVisible({
    timeout: 15_000,
  });

  // The editor shows the secret it holds, so this is where an import that
  // dropped the password on the way in would show up.
  await page.getByRole('button', { name: 'Edit WithSecret' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('hunter2', {
    timeout: 15_000,
  });
});

/*
 * A shortcut is changed by performing it, which is the whole difficulty: the
 * chord somebody is most likely to rebind is one the app already acts on. So
 * the assertion that matters is that the recorder eats the keystroke, and that
 * what it recorded is live afterwards — not merely drawn in the list.
 */
test('records a new shortcut, and the window obeys it', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'shelf-keymap-'));
  await createConnection(page, { engine: 'SQLite', file: join(directory, 'keys.db') });

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Customise' }).click();

  const sheet = page.getByRole('dialog').last();
  await expect(sheet.getByText('New query tab')).toBeVisible();

  await sheet.getByRole('button', { name: 'Change the shortcut for New query tab' }).click();
  await expect(sheet.getByText('Press a shortcut')).toBeVisible();

  /*
   * ⌘J while the recorder is armed. If the chord reached the window instead of
   * the recorder this would be opening whatever ⌘J opens, and the slot would
   * still be empty.
   */
  await page.keyboard.press('ControlOrMeta+j');
  await expect(sheet.locator('.record__slot')).not.toHaveClass(/record__slot--empty/);

  /*
   * Escape leaves the recorder and *not* the sheet. It could not: `useDismiss`
   * listens at the window in the capture phase and was registered when the
   * sheet opened, so it ran first and took the sheet with it.
   */
  await page.keyboard.press('Escape');
  await expect(sheet.getByText('Press a shortcut')).toBeHidden();
  await expect(sheet.getByText('New query tab')).toBeVisible();

  await sheet.getByRole('button', { name: 'Change the shortcut for New query tab' }).click();
  await page.keyboard.press('ControlOrMeta+j');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet.getByText('Press a shortcut')).toBeHidden();

  // Out of both sheets, one Escape each, and then the chord that was recorded.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.keyboard.press('ControlOrMeta+j');
  await expect(page.locator('.striptab')).toHaveCount(1);

  // And the one it replaced does nothing, because a binding is replaced whole.
  await page.keyboard.press('ControlOrMeta+t');
  await expect(page.locator('.striptab')).toHaveCount(1);

  /*
   * And it survives a reload, because the keymap is stored rather than held.
   * A reload comes back to the start screen — the connection is not resumed —
   * so what is checked is the stored map itself, which is where the answer is.
   */
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Shelf' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Customise' }).click();
  await expect(page.getByRole('dialog').last().getByText('⌘J')).toBeVisible();
});

/*
 * The connection's own menu, and the sheet behind it.
 *
 * What is worth asserting is that the diagnosis is *measured*: every row in it
 * comes from a call that ran, so a sheet that draws its checks without making
 * them would show the same green ticks. The count beside each probe is the one
 * thing a mock could not invent — it is the length of what came back.
 */
test('diagnoses the connection it is attached to', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'shelf-health-'));
  await createConnection(page, { engine: 'SQLite', file: join(directory, 'health.db') });

  await page.locator('.switcher__row').click();
  await expect(page.getByRole('menuitem', { name: 'Disconnect' })).toBeVisible();
  // The name is the row that opened the menu; the item is the verb.
  await expect(page.getByRole('menuitem', { name: /Disconnect from/ })).toHaveCount(0);

  await page.getByRole('menuitem', { name: /Diagnose/ }).click();

  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Round trip')).toBeVisible();

  // Fifteen kept, and a warm-up thrown away — a first round trip pays for
  // everything both ends do lazily and it made every healthy connection here
  // report itself as erratic.
  await expect(sheet.getByText('15 pings kept')).toBeVisible({ timeout: 15_000 });
  await expect(sheet.locator('.trace__bar')).toHaveCount(15);

  // A check that ran, with what came back from it.
  await expect(sheet.getByText('Tables')).toBeVisible();
  await expect(sheet.locator('.check--failed')).toHaveCount(0);
});

/*
 * A disclosure closes on a second press.
 *
 * It could not: dismissal happens at the window in the capture phase, so the
 * press closed the menu before the button's own click handler ran and the
 * handler opened it straight back up. Pressing twice looked like pressing
 * nothing at all.
 */
test('a menu opened from a button is closed by that button', async ({ page }) => {
  await page.getByRole('button', { name: /Sample database/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });

  const row = page.locator('.switcher__row');
  const menu = page.getByRole('menu');

  await row.click();
  await expect(menu).toBeVisible();
  await row.click();
  await expect(menu).toBeHidden();

  // ...and a press anywhere else still closes it, which is the behaviour the
  // trigger had to be carved out of rather than replace.
  await row.click();
  await expect(menu).toBeVisible();
  await page.locator('.content').click({ position: { x: 300, y: 300 } });
  await expect(menu).toBeHidden();

  // The tab strip's plus is the same shape of control, and had the same fault.
  await page.keyboard.press('ControlOrMeta+t');
  const plus = page.getByRole('button', { name: /new tab/i }).first();
  await plus.click();
  await expect(menu).toBeVisible();
  await plus.click();
  await expect(menu).toBeHidden();
});
