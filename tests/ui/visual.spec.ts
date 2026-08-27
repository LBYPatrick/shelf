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
import { newQueryTab, setAppearance, stabilize, test, expect } from './fixtures';
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
    /*
     * The dial put back where it started, first.
     *
     * The appearance settings persist for the life of the worker, and one of
     * the invariants drags the opacity slider to prove it paints the number it
     * shows — so this frame photographed whatever that test happened to leave
     * behind, and the baseline was whatever it had left behind on the day the
     * snapshot was taken. A snapshot that depends on the order of the suite is
     * a snapshot that fails for no reason and gets accepted for no reason.
     */
    await sample.evaluate(() => {
      const key = 'shelf.appearance';
      const stored: Record<string, unknown> = JSON.parse(localStorage.getItem(key) ?? '{}');
      localStorage.setItem(key, JSON.stringify({ ...stored, materials: { opacity: 0.5 } }));
    });
    // A reload drops the connection with everything else, so the sample is
    // opened again — the same dance `setAppearance` leaves its callers.
    await sample.reload();
    await sample
      .getByRole('button', { name: /sample database/i })
      .first()
      .click();
    await sample.locator('.workspace').waitFor({ timeout: 30_000 });

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
      .getByRole('button', { name: /sample database/i })
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
 *
 * The frame starts at the pane's own top edge and takes the glass to its left.
 * It used to reach sixteen pixels up into the bar, which was fine while the bar
 * was empty there and stopped being fine the day the tab strip was aligned to
 * the pane: a tab's own rounded corner moved into the shot, bringing its width,
 * its arrival animation and the number of open tabs with it. None of that is
 * what this frame is for, and that the strip meets the pane is asserted by an
 * invariant that measures it rather than photographs it.
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
    /*
     * Until the new tab has finished arriving.
     *
     * The frame is forty-eight pixels of the junction, sixteen of them above
     * the pane — and the strip begins exactly at the pane's leading edge, so a
     * tab's own rounded corner is *in* this shot. A tab grows out of nothing on
     * the way in, and caught mid-arrival it is a few pixels narrower than the
     * baseline: enough to fail, not enough to look like anything but noise.
     * `stabilize` settles animations, not a class removed on a timer.
     */
    await stabilize(sample);

    const box = (await sample.locator('.content').boundingBox())!;
    await expect(sample).toHaveScreenshot('corner-editor.png', {
      clip: { x: box.x - 16, y: box.y, width: 48, height: 48 },
    });
  });

  // `setAppearance` reloads, so the connection is made after it rather than by
  // the fixture that the reload would have dropped.
  test('the same corner on the dark theme', async ({ page }) => {
    await setAppearance(page, 'dark');
    await page
      .getByRole('button', { name: /sample database/i })
      .first()
      .click();
    await page.locator('.workspace').waitFor({ timeout: 30_000 });
    await newQueryTab(page);
    await page.locator('.monaco-editor').waitFor();
    await stabilize(page);

    const box = (await page.locator('.content').boundingBox())!;
    await expect(page).toHaveScreenshot('corner-editor-dark.png', {
      clip: { x: box.x - 16, y: box.y, width: 48, height: 48 },
    });
  });
});
