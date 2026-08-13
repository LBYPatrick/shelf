import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const r = (...p: string[]) => resolve(__dirname, ...p);

/**
 * The driver conformance suite runs in plain Node against the containers in
 * docker-compose.yml. Only the server engines are here: SQLite and DuckDB are
 * native modules compiled against Electron's ABI and cannot load under Node, so
 * they are covered end to end instead.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': r('src/shared'),
      '@drivers': r('src/drivers'),
    },
  },
  test: {
    include: ['tests/drivers/**/*.test.ts'],
    environment: 'node',
    // Real databases; a cold container can take a moment to answer the first query.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Engines share a machine; running them together starves Scylla.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
