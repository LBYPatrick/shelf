import { mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';

/**
 * Holds the system clipboard for the length of one copy-and-read.
 *
 * Everything else about a test in this suite is its own — its app, its window,
 * its user-data directory — and the clipboard is the one thing that is not.
 * There is exactly one of it per machine, and six tests here copy something and
 * read it straight back, so running the suite in parallel had them overwriting
 * each other's copy in the window between the two. It failed about one run in
 * three, always on a different test, which is the shape of a flake that gets
 * re-run rather than fixed.
 *
 * A directory is the lock because `mkdir` is atomic on every platform we run
 * on. A crashed test would otherwise leave one behind forever, so a lock older
 * than the longest a copy could take is taken to be abandoned rather than held.
 */
const CLIPBOARD_LOCK = join(tmpdir(), 'shelf-clipboard.lock');
const STALE_MS = 30_000;

export async function withClipboard<T>(run: () => Promise<T>): Promise<T> {
  for (;;) {
    try {
      await mkdir(CLIPBOARD_LOCK);
      break;
    } catch {
      const held = await stat(CLIPBOARD_LOCK).catch(() => null);
      if (held && Date.now() - held.ctimeMs > STALE_MS) {
        await rm(CLIPBOARD_LOCK, { recursive: true, force: true });
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }

  try {
    return await run();
  } finally {
    await rm(CLIPBOARD_LOCK, { recursive: true, force: true });
  }
}

/**
 * Creating a connection now happens in a sheet, so every test that needs an
 * open database goes through the same door a person would.
 */
/**
 * Another query tab, by the keystroke.
 *
 * The `+` on the strip opens a menu of the two kinds of tab now, so a click on
 * it no longer produces one — and a test that wants *a tab* should not have to
 * care which of the two ways it came.
 */
export async function newQueryTab(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+t');
}

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

/**
 * Sends the statement off as a job, answering the sheet that asks what to call
 * it.
 *
 * The name is not typed: it opens holding the stamp the job would have had
 * anyway, and taking that is the common path — a test that typed one would be
 * asserting the field works rather than that a dispatch does.
 */
export async function dispatchQuery(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'What Run performs' }).click();
  await page.getByRole('menuitem', { name: 'Dispatch' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Dispatch' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}
