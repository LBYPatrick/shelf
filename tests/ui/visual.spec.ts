/**
 * Visual regression.
 *
 * Screenshots are the backstop for everything the invariants cannot name —
 * spacing that drifted, a control that ended up the wrong size, an alignment
 * that broke. They are captured with motion disabled and against sample data,
 * so a diff means something changed rather than something moved.
 *
 * Regenerate deliberately with `make ui-accept`, and read the diff before you
 * do; a snapshot updated without being looked at is worse than no snapshot.
 */
import { setAppearance, stabilize, test, expect } from './fixtures';
import { openTable } from '../e2e/helpers';

test.describe('light', () => {
  test('start screen', async ({ page }) => {
    await stabilize(page);
    await expect(page).toHaveScreenshot('start-light.png');
  });

  test('workspace with a table open', async ({ sample }) => {
    await openTable(sample, 'album');
    await sample.locator('.tabulator-row').first().waitFor();
    await stabilize(sample);
    await expect(sample).toHaveScreenshot('table-light.png');
  });

  test('query tab', async ({ sample }) => {
    await sample
      .getByRole('button', { name: /new query/i })
      .first()
      .click();
    await sample.locator('.monaco-editor').waitFor();
    await stabilize(sample);
    await expect(sample).toHaveScreenshot('query-light.png');
  });

  test('settings sheet', async ({ sample }) => {
    await sample.getByRole('button', { name: /settings/i }).click();
    await sample.getByRole('dialog').waitFor();
    await stabilize(sample);
    await expect(sample).toHaveScreenshot('settings-light.png');
  });
});

test.describe('dark', () => {
  test('start screen', async ({ page }) => {
    await setAppearance(page, 'dark');
    await stabilize(page);
    await expect(page).toHaveScreenshot('start-dark.png');
  });

  test('workspace with a table open', async ({ page }) => {
    await setAppearance(page, 'dark');
    await page
      .getByRole('button', { name: /sample/i })
      .first()
      .click();
    await page.locator('.workspace').waitFor({ timeout: 30_000 });
    await openTable(page, 'album');
    await page.locator('.tabulator-row').first().waitFor();
    await stabilize(page);
    await expect(page).toHaveScreenshot('table-dark.png');
  });
});

test.describe('density', () => {
  // The density scale is one multiplier feeding every size in the app, so a
  // change at one end tends to break the other.
  for (const density of ['compact', 'comfortable'] as const) {
    test(density, async ({ sample }) => {
      await sample.evaluate((value) => {
        document.documentElement.dataset['density'] = value;
      }, density);
      await openTable(sample, 'album');
      await sample.locator('.tabulator-row').first().waitFor();
      await stabilize(sample);
      await expect(sample).toHaveScreenshot(`table-${density}.png`);
    });
  }
});

/*
 * The corner, on its own, at the size it actually is.
 *
 * A full-window snapshot cannot guard it: sixty-four pixels is far under the
 * diff threshold, so the corner can go square without a single test noticing —
 * which is how it went square over the editor and stayed that way. Monaco is
 * the case that matters, because a composited descendant is what defeats a
 * rounded overflow clip.
 */
test.describe('corners', () => {
  test('the content pane is cut where it meets the glass, over the editor too', async ({
    sample,
  }) => {
    await sample
      .getByRole('button', { name: /new query/i })
      .first()
      .click();
    await sample.locator('.monaco-editor').waitFor();
    await stabilize(sample);

    const box = (await sample.locator('.content').boundingBox())!;
    await expect(sample).toHaveScreenshot('corner-editor.png', {
      clip: { x: box.x - 16, y: box.y - 16, width: 48, height: 48 },
    });
  });

  // `setAppearance` reloads, so the connection is made after it rather than by
  // the fixture that the reload would have dropped.
  test('the same corner on the dark theme', async ({ page }) => {
    await setAppearance(page, 'dark');
    await page
      .getByRole('button', { name: /sample/i })
      .first()
      .click();
    await page.locator('.workspace').waitFor({ timeout: 30_000 });
    await page
      .locator('.strip')
      .getByRole('button', { name: /new query tab/i })
      .click();
    await page.locator('.monaco-editor').waitFor();
    await stabilize(page);

    const box = (await page.locator('.content').boundingBox())!;
    await expect(page).toHaveScreenshot('corner-editor-dark.png', {
      clip: { x: box.x - 16, y: box.y - 16, width: 48, height: 48 },
    });
  });
});
