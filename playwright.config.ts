import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Files prefixed with _ are developer tools (screenshot capture), not assertions.
  testIgnore: ['**/_*.spec.ts'],
  /*
   * In parallel, because every test already has an app of its own.
   *
   * This used to say instances would contend for the same app database, and
   * that was true until the fixture started handing each test a fresh
   * `mkdtemp` user-data directory — after which the note was a reason that had
   * stopped applying, and the suite spent six minutes doing forty seconds of
   * work. The tests are Electron launches, so they are bound by process start
   * and not by CPU: rather more workers than cores is the right number.
   */
  fullyParallel: true,
  workers: process.env['CI'] ? 4 : '75%',
  timeout: 60_000,
  expect: { timeout: 8_000 },
  reporter: process.env['CI'] ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
});
