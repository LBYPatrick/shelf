import { defineConfig } from '@playwright/test';

/**
 * Screenshot capture, kept out of the assertion suite. Run with `pnpm shots`
 * to eyeball the interface in both appearances after a design change.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['**/_*.spec.ts'],
  workers: 1,
  timeout: 60_000,
  reporter: 'list',
});
