import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const r = (...p: string[]) => resolve(__dirname, ...p);

export default defineConfig({
  resolve: {
    alias: {
      '@shared': r('src/shared'),
      '@drivers': r('src/drivers'),
      '@ai': r('src/ai'),
      '@renderer': r('src/renderer'),
      '@utility': r('src/utility'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
