import { test, expect, settledSheet } from './fixtures';
import { openTable } from '../e2e/helpers';

/** Category navigation must keep formerly distant preferences reachable. */
test('settings categories expose the full form and JSON with immediate keyboard navigation', async ({
  sample,
}) => {
  await sample.getByRole('button', { name: /settings/i }).click();
  const sheet = sample.getByRole('dialog');
  await settledSheet(sample, sheet);
  const nav = sheet.getByRole('navigation', { name: 'Settings' });
  await expect(sheet.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'General', exact: true }).click();
  await expect(sheet.getByLabel('Language', { exact: true })).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Appearance', exact: true })).toBeHidden();

  const editor = nav.getByRole('button', { name: 'Editor', exact: true });
  await editor.focus();
  await sample.keyboard.press('Enter');
  await expect(sheet.locator('#settings-font-size')).toBeVisible();
  expect(
    await sheet
      .locator('.settings-content')
      .evaluate((element) => element.getAnimations().length)
  ).toBe(0);
  await expect(editor).toHaveAttribute('aria-current', 'page');

  await nav.locator('[data-settings-category="data"]').click();
  await expect(sheet.locator('#settings-page-size')).toBeVisible();
  await nav.locator('[data-settings-category="file"]').click();
  await expect(sheet.getByRole('heading', { name: 'Stored data', exact: true })).toBeVisible();
  await nav.locator('[data-settings-category="about"]').click();
  await expect(sheet.getByRole('heading', { name: 'Updates', exact: true })).toBeVisible();
  await nav.locator('[data-settings-category="json"]').click();
  await expect(sheet.locator('.json')).toBeVisible();
  await expect(sheet.locator('.monaco-editor')).toContainText('shelf.settings');
  await expect(sheet.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
});

test('settings uses a side rail in wide windows and a bounded category row in narrow windows', async ({
  app,
  sample,
}) => {
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    window.setMinimumSize(500, 400);
    window.setSize(1150, 780);
  });
  await sample.getByRole('button', { name: /settings/i }).click();
  const sheet = sample.getByRole('dialog');
  await settledSheet(sample, sheet);
  const rail = await sheet.locator('.settings-nav').boundingBox();
  const content = await sheet.locator('.settings-content').boundingBox();
  expect(content!.x).toBeGreaterThanOrEqual(rail!.x + rail!.width - 1);

  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setSize(620, 780)
  );
  await settledSheet(sample, sheet);
  const bounds = await sheet.boundingBox();
  const viewportWidth = await sample.evaluate(() => window.innerWidth);
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewportWidth + 1);
  await sheet.locator('[data-settings-category="json"]').click();
  await expect(sheet.locator('.json')).toBeVisible();
  const overflow = await sheet
    .locator('.settings-layout')
    .evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('export distinguishes the whole table file from loaded clipboard rows and supports radio keyboard choices', async ({
  sample,
}) => {
  await openTable(sample, 'artist');
  await expect(sample.locator('.tabulator-row').first()).toBeVisible();
  await sample.getByRole('button', { name: 'Export', exact: true }).click();
  const sheet = sample.getByRole('dialog');
  await settledSheet(sample, sheet);
  await expect(sheet.getByText('All matching rows', { exact: true })).toBeVisible();
  await expect(
    sheet.getByText('Exports every matching row, including rows not currently loaded.')
  ).toBeVisible();
  const file = sheet.getByRole('radio', { name: 'File', exact: true });
  await file.focus();
  await sample.keyboard.press('ArrowRight');
  await expect(sheet.getByRole('radio', { name: 'Clipboard', exact: true })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await expect(sheet.getByText('All matching rows', { exact: true })).toBeHidden();
  const csv = sheet.getByRole('radio', { name: 'CSV', exact: true });
  await csv.focus();
  await sample.keyboard.press('End');
  await expect(sheet.getByRole('radio', { name: 'Markdown', exact: true })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await expect(sheet.getByRole('radio', { name: 'Markdown', exact: true })).toBeFocused();
  await sheet.getByRole('radio', { name: 'File', exact: true }).click();
  await expect(csv).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.getByRole('radio', { name: 'Markdown', exact: true })).toHaveCount(0);
});

test('settings keeps its frame across categories and JSON fills the remaining pane', async ({
  app,
  sample,
}) => {
  await sample.getByRole('button', { name: 'Settings', exact: true }).click();
  const sheet = sample.getByRole('dialog', { name: 'Settings', exact: true });
  for (const width of [1150, 620]) {
    await app.evaluate(({ BrowserWindow }, width) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.setMinimumSize(500, 400);
      window.setSize(width, 780);
    }, width);
    await sample.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    await settledSheet(sample, sheet);
    await sheet.evaluate(async (element) => {
      await Promise.allSettled(
        element.getAnimations({ subtree: true }).map((animation) => animation.finished)
      );
    });
    await settledSheet(sample, sheet);
    const original = await sheet.boundingBox();
    for (const category of [
      'appearance',
      'data',
      'editor',
      'general',
      'assistant',
      'file',
      'about',
      'json',
    ]) {
      await sheet.locator(`[data-settings-category="${category}"]`).click();
      await settledSheet(sample, sheet);
      const current = await sheet.boundingBox();
      expect(
        Math.abs(current!.height - original!.height),
        JSON.stringify({
          width,
          category,
          original,
          current,
          details: await sheet.evaluate((el) => ({
            offset: (el as HTMLElement).offsetHeight,
            style: (el as HTMLElement).style.height,
            animations: el
              .getAnimations()
              .map((a) => ({ state: a.playState, current: a.currentTime })),
            transform: getComputedStyle(el).transform,
          })),
        })
      ).toBeLessThanOrEqual(1);
      expect(Math.abs(current!.y - original!.y)).toBeLessThanOrEqual(1);
    }
    const fit = await sheet.locator('.settings-content').evaluate((content) => {
      const pane = content.getBoundingClientRect();
      const editor = content.querySelector('.json__editor')!.getBoundingClientRect();
      const bar = content.querySelector('.json__bar')!.getBoundingClientRect();
      return {
        topGap: editor.top - pane.top,
        editorGap: bar.top - editor.bottom,
        bottomGap: pane.bottom - bar.bottom,
        editorHeight: editor.height,
        expectedHeight: pane.height - bar.height,
      };
    });
    expect(Math.abs(fit.topGap)).toBeLessThanOrEqual(1);
    expect(Math.abs(fit.editorGap)).toBeLessThanOrEqual(1);
    expect(Math.abs(fit.bottomGap)).toBeLessThanOrEqual(1);
    expect(Math.abs(fit.editorHeight - fit.expectedHeight)).toBeLessThanOrEqual(1);
  }
});
