import { expect, test } from './fixtures';
import { revealTables, typeQuery } from './helpers';

/**
 * The quick action bar.
 *
 * It replaced the sidebar's filter box, so the things that box could do have to
 * be doable here — and the things it could never do are the reason for the
 * swap: it reaches the whole database, takes a path or a pattern, and opens
 * what you pick rather than hiding what you did not.
 */
test('finds a table by path, by pattern, and opens it', async ({ page }) => {
  await page.getByRole('button', { name: /Explore sample data/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });

  await page.keyboard.press('ControlOrMeta+k');
  const field = page.getByRole('combobox');
  await expect(field).toBeFocused();

  // A path binds its segments to the levels of the tree.
  await field.fill('music.album');
  const rows = page.locator('.palette__row');
  await expect(rows.first()).toContainText('sample.music.album');

  // A qualifier that matches nothing rules the row out, rather than falling
  // back to a plain substring search that would find it anyway.
  await field.fill('ops.album');
  await expect(page.locator('.palette')).toContainText('Nothing matches');

  // ...and says where it actually lives. `album` finding a table while
  // `ops.album` finds nothing reads as broken dot notation unless the empty
  // state names the path that would have worked.
  await expect(page.locator('.palette')).toContainText('Found under a different path');
  await page.locator('.palette__path', { hasText: 'sample.music.album' }).click();
  await expect(rows.first()).toContainText('sample.music.album');

  // A pattern is the other way of writing the same question.
  await field.fill('^a.*t$');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('artist');

  await page.keyboard.press('Enter');
  await expect(page.locator('.tabulator-row').first()).toBeVisible({ timeout: 20_000 });
});

test('runs a setting from the slash mode', async ({ page }) => {
  await page.getByRole('button', { name: /Explore sample data/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });

  const theme = () => page.evaluate(() => document.documentElement.dataset['theme']);
  expect(await theme()).toBe('shelf-light');

  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox').fill('/theme dark');

  const rows = page.locator('.palette__row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('/theme dark');
  await page.keyboard.press('Enter');

  await expect.poll(theme).toBe('shelf-dark');

  /*
   * Every command names a final state, so running it twice lands in the same
   * place. A palette of toggles would depend on what you could not see.
   */
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox').fill('/theme dark');
  await page.keyboard.press('Enter');
  await expect.poll(theme).toBe('shelf-dark');
});

test('the sidebar sends you here rather than filtering in place', async ({ page }) => {
  await page.getByRole('button', { name: /Explore sample data/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });

  await revealTables(page);
  await page.getByRole('button', { name: /Search tables/ }).click();
  await expect(page.locator('.palette')).toBeVisible();
  await expect(page.getByRole('combobox')).toBeFocused();
});

/*
 * Monaco treats ⌘K as a chord prefix — the start of ⌘K ⌘C and a dozen others —
 * so it stopped the key dead and the palette could not be opened from inside
 * the editor at all. And when it did open, the editor kept the caret and what
 * was typed went into the SQL behind it.
 */
test('opens over the query editor, and takes the typing with it', async ({ page }) => {
  await page.getByRole('button', { name: /Explore sample data/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });

  await page
    .getByRole('button', { name: /new query/i })
    .first()
    .click();
  await typeQuery(page, 'SELECT 1');

  await page.keyboard.press('ControlOrMeta+k');
  const field = page.getByRole('combobox');
  await expect(field).toBeFocused();

  await page.keyboard.type('artist');
  await expect(field).toHaveValue('artist');
  await expect(page.locator('.palette__row').first()).toContainText('artist');

  // Nothing of it reached the editor underneath.
  await page.keyboard.press('Escape');
  await expect(page.locator('.monaco-editor')).toContainText('SELECT 1');
  await expect(page.locator('.monaco-editor')).not.toContainText('artist');
});
