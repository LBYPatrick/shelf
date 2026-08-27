import { expect, test } from './fixtures';
import { newQueryTab, typeQuery } from './helpers';

/*
 * Monaco's theme is a *snapshot* of the custom properties, taken when the theme
 * is defined — so a scheme chosen in settings changes the variables and nothing
 * else until the theme is built again from them. That is the seam this covers:
 * the tokens are checked in a unit test and the picker is a control like any
 * other, but whether the editor actually repaints is neither of those.
 */
test('a scheme reaches the editor, not just the stylesheet', async ({ page }) => {
  await page.getByRole('button', { name: /Sample database/ }).click();
  await page.locator('.strip').waitFor({ timeout: 20_000 });
  await newQueryTab(page);
  await typeQuery(page, 'select id from music.artist');

  const keyword = () =>
    page.evaluate(() => {
      const spans = [
        ...document.querySelectorAll<HTMLElement>('.monaco-editor .view-line span span'),
      ];
      const el = spans.find((span) => span.textContent === 'select');
      return el ? getComputedStyle(el).color : '';
    });

  const before = await keyword();
  expect(before).not.toBe('');

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Light scheme' }).click();
  await page.getByRole('option', { name: 'Gruvbox' }).click();
  await page.keyboard.press('Escape');

  await expect.poll(keyword).not.toBe(before);
});
