import { expect, type Page } from '@playwright/test';

/**
 * Creating a connection now happens in a sheet, so every test that needs an
 * open database goes through the same door a person would.
 */
export async function createConnection(
  page: Page,
  options: { engine: string; file: string; name?: string; connect?: boolean }
): Promise<void> {
  await page
    .getByRole('button', { name: /New connection/ })
    .first()
    .click();
  await expect(page.getByRole('dialog', { name: 'New connection' })).toBeVisible();

  await page.getByRole('radio', { name: options.engine, exact: true }).click();
  await page.getByLabel('Database file').fill(options.file);
  if (options.name) await page.getByLabel('Name').fill(options.name);

  if (options.connect !== false) {
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });
  }
}

/** Types into the query editor, replacing whatever was there. */
export async function typeQuery(page: Page, sql: string): Promise<void> {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await editor.pressSequentially(sql);
}
