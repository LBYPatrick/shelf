import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const r = (...p: string[]) => resolve(__dirname, ...p);

/**
 * The version, read from the one file that holds it.
 *
 * `app.getVersion()` is not an answer here: Electron reads it from a
 * `package.json` beside the app it is running, and an unpackaged build has none
 * — so a development window reported *Electron's* version as its own. Compiled
 * in from `VERSION`, a build can only ever say what it was built from.
 */
const version = JSON.stringify(readFileSync(r('VERSION'), 'utf8').trim());

export default defineConfig({
  // Main process and the connection host are built together: both are Node-side
  // bundles that must keep native modules external so they resolve at runtime.
  main: {
    plugins: [externalizeDepsPlugin()],
    define: { __APP_VERSION__: version },
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
