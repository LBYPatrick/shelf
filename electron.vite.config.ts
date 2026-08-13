import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const r = (...p: string[]) => resolve(__dirname, ...p);

export default defineConfig({
  // Main process and the connection host are built together: both are Node-side
  // bundles that must keep native modules external so they resolve at runtime.
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': r('src/shared'),
        '@drivers': r('src/drivers'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: r('src/main/index.ts'),
          utility: r('src/utility/index.ts'),
        },
      },
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': r('src/shared') },
    },
    build: {
      rollupOptions: { input: { index: r('src/preload/index.ts') } },
    },
  },

  renderer: {
    root: r('src/renderer'),
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        '@renderer': r('src/renderer'),
        '@shared': r('src/shared'),
      },
    },
    build: {
      rollupOptions: { input: { index: r('src/renderer/index.html') } },
    },
  },
});
