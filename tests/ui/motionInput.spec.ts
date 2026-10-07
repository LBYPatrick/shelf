import { test, expect } from './fixtures';

test('keyboard tab creation and selection settle without an entrance queue', async ({
  sample,
}) => {
  await sample.keyboard.press('ControlOrMeta+t');
  await sample.keyboard.press('ControlOrMeta+t');
  await expect(sample.locator('.striptab')).toHaveCount(2);
  const first = sample.locator('.striptab').first();
  await first.focus();
  await first.press('Enter');
  await expect(first).toHaveAttribute('aria-selected', 'true');
  const motion = await sample.locator('.strip__marker').evaluate((marker) => ({
    transition: getComputedStyle(marker).transitionProperty,
    queuedRegions: document.querySelectorAll('.content__pane--opening').length,
  }));
  expect(motion.transition).toBe('none');
  expect(motion.queuedRegions).toBe(0);
});

test('keyboard context menus are immediate while pointer menus remain anchored', async ({
  sample,
}) => {
  await sample.keyboard.press('ControlOrMeta+t');
  const tab = sample.locator('.striptab').first();
  await tab.focus();
  await tab.press('Shift+F10');
  const menu = sample.getByRole('menu');
  await expect(menu).toBeVisible();
  expect(
    await menu.evaluate((element) => element.classList.contains('menu-enter-active'))
  ).toBe(false);
  await sample.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await tab.click({ button: 'right' });
  await expect(menu).toBeVisible();
  const origin = await menu.evaluate((element) => getComputedStyle(element).transformOrigin);
  expect(origin).toMatch(/px/);
});
