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

/**
 * The repository releases come from, as `owner/repo`.
 *
 * From `package.json`'s `repository` field, which is the same line
 * electron-builder resolves its GitHub publish target from — so the feed the
 * updater reads and the page it offers cannot drift apart. A manifest without a
 * usable one fails the build rather than shipping an app that checks a
 * repository that does not exist.
 */
const manifest = JSON.parse(readFileSync(r('package.json'), 'utf8')) as {
  repository?: { url?: string };
};
const slug = /github\.com[/:]([^/]+\/[^/.]+)/.exec(manifest.repository?.url ?? '')?.[1];
if (!slug) throw new Error('package.json needs a GitHub "repository" url for updates.');
const repository = JSON.stringify(slug);

export default defineConfig({
  // Main process and the connection host are built together: both are Node-side
  // bundles that must keep native modules external so they resolve at runtime.
  main: {
    plugins: [externalizeDepsPlugin()],
    define: { __APP_VERSION__: version, __APP_REPOSITORY__: repository },
    resolve: {
      alias: {
        '@shared': r('src/shared'),
        '@drivers': r('src/drivers'),
        '@ai': r('src/ai'),
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
