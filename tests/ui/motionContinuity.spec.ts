import { test, expect } from './fixtures';
import { revealTables } from '../e2e/helpers';

// Dispatch in one event turn: Playwright's pointer actionability waits can let
// the first 140ms exit complete, hiding the lost-action regression.
test('overlapping tree exits preserve both actions and repeated toggles', async ({
  sample,
}) => {
  await revealTables(sample);
  const album = sample.getByRole('treeitem', { name: 'album', exact: true });
  const artist = sample.getByRole('treeitem', { name: 'artist', exact: true });
  await album.click();
  await artist.click();
  await expect(album).toHaveAttribute('aria-expanded', 'true');
  await expect(artist).toHaveAttribute('aria-expanded', 'true');
  await expect(sample.getByRole('treeitem', { name: /^artist_id/ }).first()).toBeVisible();
  await sample.evaluate(() => {
    const find = (name: string) =>
      [...document.querySelectorAll<HTMLElement>('.tree [role="treeitem"]')].find(
        (row) => row.getAttribute('aria-label') === name
      )!;
    find('album').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    find('artist').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  });
  await expect(album).toHaveAttribute('aria-expanded', 'false');
  await expect(artist).toHaveAttribute('aria-expanded', 'false');
  await album.click();
  await expect(album).toHaveAttribute('aria-expanded', 'true');
  await album.evaluate((row: HTMLElement) => {
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  });
  await sample.waitForTimeout(180);
  await expect(album).toHaveAttribute('aria-expanded', 'true');
});

test('tree keyboard and reduced-motion collapses commit in the event turn', async ({
  sample,
}) => {
  await revealTables(sample);
  const album = sample.getByRole('treeitem', { name: 'album', exact: true });
  await album.click();
  await expect(album).toHaveAttribute('aria-expanded', 'true');
  const keyboardInstant = await album.evaluate(async (row) => {
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await Promise.resolve();
    return row.getAttribute('aria-expanded') === 'false';
  });
  expect(keyboardInstant).toBe(true);
  await expect(album).toHaveAttribute('aria-expanded', 'false');
  await sample.emulateMedia({ reducedMotion: 'reduce' });
  await album.click();
  await expect(album).toHaveAttribute('aria-expanded', 'true');
  await album.evaluate((row: HTMLElement) => row.click());
  // State is patched at the next microtask, not after a visual timeout.
  expect(await album.getAttribute('aria-expanded')).toBe('false');
});

test('transcript growth follows its pinned reader without adding items', async ({ sample }) => {
  await sample.evaluate(async () => {
    await window.shelf.db.saveChat({
      connectionId: 'sample',
      title: 'Streaming geometry',
      body: JSON.stringify({
        scope: { kind: 'connection' },
        turns: [
          {
            id: 'turn',
            question: 'Explain the albums',
            state: 'done',
            items: [{ kind: 'text', text: 'The answer grows in this same item.' }],
          },
        ],
      }),
    });
  });
  await sample.getByRole('button', { name: 'Chats', exact: true }).click();
  await sample.locator('.chats .tile').first().click();
  const column = sample.locator('.chat__column');
  await expect(column.locator('.prose')).toBeVisible();
  // Geometry changes model deltas and late Markdown layout produce. The item
  // count stays at one, so the old count-only watcher never answered this.
  await column.locator('.prose').evaluate((element) => {
    element.textContent = 'A long wrapped streamed sentence about albums. '.repeat(350);
  });
  const bottomDistance = () =>
    sample
      .locator('.chat__scroll')
      .evaluate((box) => box.scrollHeight - box.scrollTop - box.clientHeight);
  await expect.poll(bottomDistance).toBeLessThan(2);
  await sample.locator('.chat__scroll').evaluate((box) => {
    box.scrollTop = 100;
    box.dispatchEvent(new Event('scroll'));
  });
  const retained = await sample.locator('.chat__scroll').evaluate((box) => box.scrollTop);
  await column.locator('.prose').evaluate((element) => {
    element.textContent += 'More text in the same streamed item. '.repeat(300);
  });
  await sample.waitForTimeout(80);
  expect(await sample.locator('.chat__scroll').evaluate((box) => box.scrollTop)).toBe(retained);
  await expect(column.locator('.prose')).toHaveCount(1);
});

// A slow visual exit makes the business/visual ownership race observable even
// on a fast machine. SQLite connects independently of the transition duration.
test('save-and-connect retains its owning view until the editor finishes leaving', async ({
  page,
}) => {
  await page.evaluate(() => document.documentElement.style.setProperty('--t-sheet', '800ms'));
  await page
    .getByRole('button', { name: /New connection/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'New connection', exact: true });
  await expect(dialog).toBeVisible();
  await page.getByRole('radio', { name: 'SQLite', exact: true }).click();
  await page.getByLabel('Database file', { exact: true }).fill(':memory:');
  await page.getByLabel('Name', { exact: true }).fill('Fast connection, full exit');
  await page.getByRole('button', { name: 'Save & connect', exact: true }).click();
  await expect(page.locator('.sheet-leave-active')).toBeVisible();
  await expect(page.locator('.workspace')).toHaveCount(0);
  await expect(page.locator('.workspace')).toBeVisible();
  await expect(dialog).toHaveCount(0);
});
