import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const r = (...p: string[]) => resolve(__dirname, ...p);

export default defineConfig({
  resolve: {
    alias: {
      '@shared': r('src/shared'),
      '@drivers': r('src/drivers'),
      '@renderer': r('src/renderer'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
