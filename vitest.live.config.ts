import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const r = (...p: string[]) => resolve(__dirname, ...p);

/**
 * The live assistant suite, kept out of the ordinary one.
 *
 * `make test` must be deterministic, free, and runnable on a machine with no
 * network. This suite is none of those: it spends money, needs a signed-in
 * Claude Code, and can fail because a provider is having a bad afternoon. Run
 * with `make test-assistant`; it skips itself rather than failing when the CLI
 * is not installed.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': r('src/shared'),
      '@drivers': r('src/drivers'),
      '@renderer': r('src/renderer'),
      '@utility': r('src/utility'),
      '@ai': r('src/ai'),
    },
  },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    // One model call at a time: three suites racing each other through the same
    // rate limit is a flake with a plausible-looking error message.
    fileParallelism: false,
    testTimeout: 180_000,
  },
});
