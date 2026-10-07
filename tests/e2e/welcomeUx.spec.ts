import type { Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { test, expect } from './fixtures';
import { setAppearance } from '../ui/fixtures';

async function seedLibrary(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let index = 0; index < 1000; index++) {
      await window.shelf.db.saveConnection({
        name: `Database ${String(index).padStart(4, '0')}`,
        engine: 'sqlite',
        config: { engine: 'sqlite', filePath: `/tmp/shelf-library-${index}.sqlite` },
      });
    }
    const saved = await window.shelf.db.listConnections();
    for (let index = 0; index < 250; index++) {
      await window.shelf.db.recordHistory({
        connectionId: saved[0]!.id,
        text: `select ${index} as historical_value`,
        succeeded: true,
        rowCount: 1,
        durationMs: 2,
      });
    }
  });
  await page.reload();
}

test('a large library is bounded, searchable, and keyboard accessible', async ({ page }) => {
  await seedLibrary(page);
  await expect(page.locator('.group__row')).toHaveCount(40);
  await expect(page.getByText('Page 1 of 25 · 1000 entries')).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Connect to Database 0040', exact: true })
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Paste a connection URL or search', exact: true })
    .fill('0999');
  await expect(page.locator('.group__row')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Connect to Database 0999', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('radio', { name: 'Saved', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Recent', exact: true })).toBeFocused();
  await expect(page.getByText('No connections have been opened yet.')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.history-entry')).toHaveCount(40);
  await expect(page.getByText('Page 1 of 7 · 250 entries')).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Paste a connection URL or search', exact: true })
    .fill('select 0 as');
  await expect(page.locator('.history-entry')).toHaveCount(1);
  await page.locator('.history-entry').click();
  await expect(page.getByRole('dialog', { name: 'Query history', exact: true })).toBeVisible();
  await expect(page.locator('.history-statement')).toContainText('historical_value');
});

test('history opens after session restoration without executing the statement', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const connection = await window.shelf.db.saveConnection({
      name: 'Recover query',
      engine: 'sqlite',
      config: { engine: 'sqlite', filePath: ':memory:' },
    });
    await window.shelf.db.recordHistory({
      connectionId: connection.id,
      text: 'select 777 as resume_only',
      succeeded: true,
      rowCount: 1,
      durationMs: 1,
    });
  });
  await page.reload();
  await page.getByRole('radio', { name: 'Query history', exact: true }).click();
  await page.locator('.history-entry').click();
  await page
    .getByRole('dialog', { name: 'Query history', exact: true })
    .getByRole('button', { name: 'Open in query tab' })
    .click();
  await expect(page.locator('.workspace')).toBeVisible();
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await expect(page.locator('.monaco-editor')).toContainText('resume_only');
  expect(await page.evaluate(() => window.shelf.db.listHistory(null))).toHaveLength(1);
  await expect(page.locator('.tabulator-row')).toHaveCount(0);
});

test('review welcome library at scale in both themes', async ({ app, page }) => {
  await mkdir('/tmp/shelf-welcome-review', { recursive: true });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setSize(1100, 740)
  );
  await page.screenshot({ path: '/tmp/shelf-welcome-review/empty.png' });
  await seedLibrary(page);
  for (const theme of ['light', 'dark'] as const) {
    await setAppearance(page, theme);
    await page.locator('.group__row').first().waitFor();
    await page.screenshot({ path: `/tmp/shelf-welcome-review/library-${theme}.png` });
    await page.getByRole('radio', { name: 'Query history', exact: true }).click();
    await page.locator('.history-entry').first().waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `/tmp/shelf-welcome-review/history-${theme}.png` });
  }
});

test('history remains inspectable when its saved connection has been removed', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const connection = await window.shelf.db.saveConnection({
      name: 'Removed database',
      engine: 'sqlite',
      config: { engine: 'sqlite', filePath: ':memory:' },
    });
    await window.shelf.db.recordHistory({
      connectionId: connection.id,
      text: 'select 42 as recoverable_statement',
      succeeded: true,
      rowCount: 1,
      durationMs: 1,
    });
    await window.shelf.db.removeConnection(connection.id);
  });
  await page.reload();
  await page.getByRole('radio', { name: 'Query history', exact: true }).click();
  await page.locator('.history-entry').click();
  const preview = page.getByRole('dialog', { name: 'Query history', exact: true });
  await expect(preview.locator('.history-statement')).toContainText('recoverable_statement');
  await expect(preview.getByRole('button', { name: 'Copy', exact: true })).toBeEnabled();
  await expect(
    preview.getByRole('button', { name: 'Open in query tab', exact: true })
  ).toBeDisabled();
});
