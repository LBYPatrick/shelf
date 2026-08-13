import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Files prefixed with _ are developer tools (screenshot capture), not assertions.
  testIgnore: ['**/_*.spec.ts'],
  // Electron tests drive a real app instance; running them in parallel would
  // have several instances contend for the same app database.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  reporter: process.env['CI'] ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
});
