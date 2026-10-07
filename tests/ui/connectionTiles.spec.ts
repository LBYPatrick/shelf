import { mkdir } from 'node:fs/promises';
import { test, expect, setAppearance } from './fixtures';

test('connection tiles align metadata and keep tools stable during pointer feedback', async ({
  app,
  page,
}) => {
  await mkdir('/tmp/shelf-tiles-review', { recursive: true });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setSize(1100, 740)
  );
  await page.evaluate(async () => {
    const seed = [
      {
        name: 'Production',
        engine: 'postgres',
        host: 'database.internal',
        port: 5432,
        database: 'taskflow',
        readOnly: true,
      },
      {
        name: 'Analytics warehouse — production replica with a very long connection name',
        engine: 'mysql',
        host: 'analytics-long-hostname.internal.company.example',
        port: 3306,
        database: 'reporting',
      },
      { name: 'Local cache', engine: 'redis', host: 'localhost', port: 6379 },
      {
        name: '東京のデータ · 研究 🧪',
        engine: 'duckdb',
        filePath: '/Users/example/Library/Application Support/Shelf/Research/warehouse.duckdb',
      },
    ];
    for (const [index, c] of seed.entries()) {
      const saved = await window.shelf.db.saveConnection({
        name: c.name,
        engine: c.engine,
        readOnly: c.readOnly,
        rememberSecrets: false,
        config: { ...c },
      });
      if (index === 0) await window.shelf.db.markConnectionUsed(saved.id);
    }
  });
  await page.reload();
  for (const theme of ['light', 'dark'] as const) {
    await setAppearance(page, theme);
    await page.locator('.group__row').first().waitFor();
    await page.mouse.move(1, 1);
    await page.screenshot({ path: `/tmp/shelf-tiles-review/${theme}.png` });
    const row = page.locator('.group__row').first();
    expect(await row.getByRole('button').count()).toBe(2);
    const trigger = row.getByRole('button', { name: /^Actions for / });
    await trigger.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('menuitem', { name: 'Edit', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Duplicate', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Save to a file…' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Copy to clipboard' })).toBeVisible();
    await page.screenshot({ path: `/tmp/shelf-tiles-review/${theme}-menu.png` });
    // Clicking the same trigger closes the menu rather than reopening it.
    await trigger.click();
    await expect(page.getByRole('menu')).toBeHidden();
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    const before = await row.locator('.row__actions').boundingBox();
    await row.hover();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `/tmp/shelf-tiles-review/${theme}-hover.png` });
    expect(await row.locator('.row__actions').boundingBox()).toEqual(before);
    const bounds = await page.locator('.group__row').evaluateAll((rows) =>
      rows.map((row) => {
        const title = row.querySelector('.row__title')!.getBoundingClientRect();
        const time = row.querySelector('.row__meta')!.getBoundingClientRect();
        const actions = row.querySelector('.row__actions')!.getBoundingClientRect();
        return {
          titleX: title.x,
          timeRight: time.right,
          actionsX: actions.x,
          height: row.getBoundingClientRect().height,
        };
      })
    );
    expect(new Set(bounds.map((b) => b.titleX))).toHaveProperty('size', 1);
    expect(new Set(bounds.map((b) => b.timeRight))).toHaveProperty('size', 1);
    expect(new Set(bounds.map((b) => b.actionsX))).toHaveProperty('size', 1);
    expect(new Set(bounds.map((b) => b.height))).toHaveProperty('size', 1);
  }
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    window.setMinimumSize(680, 520);
    window.setSize(800, 650);
  });
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(800);
  await page.mouse.move(1, 1);
  await page.screenshot({ path: '/tmp/shelf-tiles-review/narrow.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.group__row').first().hover();
  await expect(page.locator('.group__row .row__mark').first()).toHaveCSS('transform', 'none');
  const tile = page.locator('.group__row').filter({ hasText: 'Local cache' });
  await tile.getByRole('button', { name: 'Actions for Local cache' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Local cache copy');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.locator('.group__row .row__open').first().focus();
  await expect(page.locator('.group__row .row__open').first()).toBeFocused();
});
