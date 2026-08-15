import { expect, test } from './fixtures';

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
  await page.getByRole('button', { name: /Explore sample data/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Settings', exact: true }).click();

  // The dialog is named by its own heading, so it stops answering to "Settings"
  // the moment the language changes — which is the point.
  const settings = page.getByRole('dialog');
  // A real listbox now, not a native select: open it and choose, which is what
  // a person does and what a native `selectOption` could never exercise.
  await settings.getByLabel('Language').click();
  await settings.getByRole('option', { name: '日本語' }).click();

  await expect(settings.getByText('外観')).toBeVisible();
  // Option labels are built at setup time unless they are computed; these used
  // to keep whichever language the component mounted in.
  await expect(settings.getByRole('radio', { name: 'ダーク' })).toBeVisible();
  // And it reaches the workspace behind the sheet, not just the sheet itself.
  await page.keyboard.press('Escape');
  await expect(page.getByText('何も開いていません')).toBeVisible();
  await expect(page.getByRole('button', { name: /テーブルを検索/ })).toBeVisible();

  // And it survives a reload, because the choice is persisted.
  await page.reload();
  await expect(page.getByText('サンプルデータを試す')).toBeVisible({ timeout: 20_000 });
});

/*
 * Every overlay used to listen for Escape itself, at the window and in the
 * capture phase — and listeners on the same node in the same phase all run, so
 * one press dismissed the whole pile. A select inside a sheet took the sheet
 * with it.
 */
test('escape dismisses one overlay at a time, from the top', async ({ page }) => {
  await page.getByRole('button', { name: /Explore sample data/ }).click();
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
