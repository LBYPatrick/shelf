import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

async function seedTabs(page: Page, count: number, active = count - 1): Promise<void> {
  await page.evaluate(
    async ({ count, active }) => {
      const tabs = Array.from({ length: count }, (_, index) => ({
        id: `tab-${index + 1}`,
        kind: 'query',
        title: `Query ${index + 1} — ${'a very long title '.repeat(12)}`,
        subtitle: 'an_unbroken_schema_name_that_is_much_wider_than_the_entire_tab',
        text: `select ${index + 1} as value;`,
      }));
      await window.shelf.db.setSetting('session:sample', { tabs, activeId: tabs[active]!.id });
    },
    { count, active }
  );
  await page
    .getByRole('button', { name: /sample database/i })
    .first()
    .click();
  await expect(page.locator('.striptab')).toHaveCount(count);
  await page.waitForTimeout(400);
}

test('crowded tabs contain long titles and scopes and keep close targets clickable', async ({
  page,
}) => {
  await seedTabs(page, 32);
  await page.evaluate(() => {
    document.documentElement.dataset['density'] = 'compact';
  });
  const active = page.locator('.striptab--on');
  const geometry = await active.evaluate((tab) => {
    const bounds = tab.getBoundingClientRect();
    const close = tab.querySelector('.striptab__close')!.getBoundingClientRect();
    const scroller = document.querySelector('.strip__scroll')!.getBoundingClientRect();
    return {
      right: bounds.right,
      closeRight: close.right,
      closeWidth: close.width,
      visibleHeight: Math.min(bounds.bottom, close.bottom) - Math.max(bounds.top, close.top),
      scrollerRight: scroller.right,
    };
  });
  expect(geometry.closeRight).toBeLessThanOrEqual(geometry.right);
  expect(geometry.closeRight).toBeLessThanOrEqual(geometry.scrollerRight + 1);
  expect(geometry.closeWidth).toBeGreaterThanOrEqual(28);
  expect(geometry.visibleHeight).toBeGreaterThanOrEqual(28);
  await active.locator('.striptab__close').click();
  await expect(page.locator('.striptab')).toHaveCount(31);
  await page.locator('.striptab--on .striptab__close').click();
  await expect(page.locator('.striptab')).toHaveCount(30);
  await page.locator('.strip__new').click();
  await expect(page.getByRole('menuitem', { name: /^New query/ })).toBeVisible();
});

for (const [action, expected] of [
  ['Close tabs to the left', [3, 4, 5, 6]],
  ['Close tabs to the right', [1, 2, 3]],
  ['Close other tabs', [3]],
  ['Close tab', [1, 2, 4, 5, 6]],
] as const) {
  test(`tab context menu: ${action}`, async ({ page }) => {
    await seedTabs(page, 6, 0);
    const target = page.locator('.striptab').nth(2);
    const originalActive = await page.locator('.striptab--on').getAttribute('aria-label');
    await target.click({ button: 'right' });
    // A context click must not switch the editor behind the menu.
    await expect(page.locator('.striptab--on')).toHaveAttribute('aria-label', originalActive!);
    await page.getByRole('menuitem', { name: new RegExp(`^${action}(?:\\s|$)`) }).click();
    await expect(page.locator('.striptab')).toHaveCount(expected.length);
    expect(await page.locator('.striptab__title').allTextContents()).toEqual(
      expected.map((n) => `Query ${n} — ${'a very long title '.repeat(12)}`)
    );
  });
}

test('keyboard tab menu duplicates the current editor text beside its source', async ({
  page,
}) => {
  await seedTabs(page, 3, 0);
  const target = page.locator('.striptab').nth(1);
  await target.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByRole('menuitem', { name: 'Duplicate tab', exact: true }).click();
  await expect(page.locator('.striptab')).toHaveCount(4);
  await expect(page.locator('.striptab').nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const session = await window.shelf.db.getSetting<{
          tabs: { id: string; text: string }[];
        } | null>('session:sample', null);
        return session?.tabs.map((tab) => tab.text);
      })
    )
    .toEqual([
      'select 1 as value;',
      'select 2 as value;',
      'select 2 as value;',
      'select 3 as value;',
    ]);
});

test('tab menu disables empty ranges and Escape leaves the tab open', async ({ page }) => {
  await seedTabs(page, 2, 0);
  await page.locator('.striptab').first().click({ button: 'right' });
  await expect(
    page.getByRole('menuitem', { name: 'Close tabs to the left', exact: true })
  ).toBeDisabled();
  await expect(
    page.getByRole('menuitem', { name: 'Close tabs to the right', exact: true })
  ).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await page.locator('.striptab').last().click({ button: 'right' });
  await expect(
    page.getByRole('menuitem', { name: 'Close tabs to the right', exact: true })
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('.striptab')).toHaveCount(2);
});
