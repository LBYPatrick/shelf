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

/**
 * Opens a table from the sidebar, whatever depth it is at.
 *
 * Schemas are folders now and folders start shut, so a table in a database with
 * more than one schema is not on screen until its schema is opened. Tests go
 * through here rather than each knowing which engines group their tables and
 * which do not — a SQLite file has one schema and hides the level entirely.
 */
export async function revealTables(page: Page): Promise<void> {
  for (const folder of await page.locator('.row--schema').all()) {
    const open = await folder.getAttribute('aria-expanded');
    if (open === 'false') await folder.click();
  }
}

export async function openTable(page: Page, name: string): Promise<void> {
  const row = page.getByRole('treeitem', { name, exact: true }).first();
  if (!(await row.isVisible().catch(() => false))) await revealTables(page);
  await row.dblclick();
}

/**
 * Types into the query editor, replacing whatever was there.
 *
 * Monaco paints the text itself and takes input through the EditContext API —
 * there is no textarea and no contenteditable to address, so the click goes to
 * the painted surface and the keystrokes go to the page. Every test goes
 * through here rather than knowing that, which is what kept swapping the editor
 * to a change in one function.
 */
export async function typeQuery(page: Page, sql: string): Promise<void> {
  const editor = page.locator('.monaco-editor').first();
  await editor.waitFor();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(sql);
}
