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

interface ShelfFixtures {
  app: ElectronApplication;
  page: Page;
}

/**
 * Launches the built app against a throwaway user-data directory, so tests
 * never read or write the developer's real connections and settings.
 */
export const test = base.extend<ShelfFixtures>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright requires the destructured fixture parameter
  app: async ({}, use) => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'shelf-e2e-'));

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
    await use(page);
  },
});

export { expect } from '@playwright/test';
