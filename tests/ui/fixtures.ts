import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));

interface UiFixtures {
  app: ElectronApplication;
  page: Page;
  /** The workspace, opened on the built-in sample database. */
  sample: Page;
}

/**
 * The gate runs against sample mode rather than a live server: the data is
 * identical on every machine and in CI, which is what makes comparing a
 * screenshot to a stored one meaningful rather than flaky.
 */
export const test = base.extend<UiFixtures>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright requires the destructured form
  app: async ({}, use) => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'shelf-ui-'));
    const app = await electron.launch({
      args: [resolve(here, '../../out/main/index.js'), `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test', SHELF_E2E: '1' },
    });
    await use(app);
    await app.close();
    await rm(userDataDir, { recursive: true, force: true });
  },

  page: async ({ app }, use) => {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    /*
     * Say what the machine thinks of translucency, rather than asking it.
     *
     * Half of what this suite checks is the material layer — three surfaces a
     * measured distance apart, and screenshots taken with `omitBackground` so
     * they record that distance. All of it collapses under
     * `prefers-reduced-transparency: reduce`, which is correct behaviour and
     * exactly what the app is supposed to do: every panel goes opaque.
     *
     * A headless macOS runner reports `reduce`. So the suite passed on a
     * developer's desk and failed twenty-one ways in CI, on an app that was
     * behaving properly in both places — the tests had simply never said which
     * of the two appearances they were about. This is the same thing
     * `setAppearance` does for light and dark: pin it, so a difference in the
     * result is a difference in the code.
     *
     * A test that wants the other appearance emulates it for itself.
     */
    const cdp = await app.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }],
    });

    await use(page);
  },

  sample: async ({ page }, use) => {
    await page
      .getByRole('button', { name: /sample database/i })
      .first()
      .click();
    await page.locator('.workspace').waitFor({ timeout: 30_000 });
    await use(page);
  },
});

export { expect } from '@playwright/test';

/**
 * Another query tab, by the keystroke rather than by the button.
 *
 * The `+` on the strip opens a menu of the two kinds now, so a click on it no
 * longer produces a tab — and a test that wants *a tab* should not have to
 * care which of the two ways it came. The shortcut is a real path a reader
 * uses and is one call instead of two.
 */
export async function newQueryTab(page: Page, times = 1): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await page.keyboard.press('ControlOrMeta+t');
  }
}

/**
 * Switches appearance the way the settings sheet does, and waits for it.
 *
 * The key and the field both have to be right, and for a long time neither was
 * — this wrote `shelf.settings.appearance` where the store reads
 * `shelf.appearance.mode`, so every "dark mode" check in this suite was in fact
 * running in light mode and passing for that reason. The assertion at the end
 * is there so that can never be silently true again.
 */
export async function setAppearance(page: Page, mode: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    const key = 'shelf.appearance';
    const stored: Record<string, unknown> = JSON.parse(localStorage.getItem(key) ?? '{}');
    localStorage.setItem(key, JSON.stringify({ ...stored, mode: value }));
  }, mode);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  const theme = await page.evaluate(() => document.documentElement.dataset['theme']);
  if (theme !== `shelf-${mode}`) {
    throw new Error(`appearance did not switch: wanted shelf-${mode}, got ${theme}`);
  }
}

/** Freezes anything that would make a screenshot differ between identical runs. */
export async function stabilize(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
      caret-color: transparent !important;
    }`,
  });
  // The version string and row timings are real values that change per machine.
  await page.addStyleTag({ content: `.statusbar__version { visibility: hidden !important; }` });

  /*
   * And wait for anything that was already moving to stop.
   *
   * Zeroing the durations only stops what starts *after* the stylesheet lands.
   * A sheet opens with a 300ms scale-and-lift, so a shot taken while one is in
   * flight catches the panel at 97% — every glyph in it a couple of pixels
   * from where it belongs, which is a whole-image difference that has nothing
   * to do with the design. It bit as soon as the settings sheet grew: the
   * bigger the panel, the later it settles.
   */
  await page
    .waitForFunction(
      () => {
        const panel = document.querySelector('.panel');
        if (!panel) return true;

        const box = panel.getBoundingClientRect();
        const seen = (window as unknown as { __box?: string }).__box;
        const now = `${Math.round(box.width)}x${Math.round(box.height)}@${Math.round(box.top)}`;
        (window as unknown as { __box?: string }).__box = now;
        return seen === now;
      },
      undefined,
      { polling: 'raf', timeout: 5_000 }
    )
    .catch(() => undefined);
}
