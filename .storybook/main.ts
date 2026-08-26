import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { mergeConfig } from 'vite';
import type { StorybookConfig } from '@storybook/vue3-vite';

/*
 * `__dirname` does not exist here: the config is loaded as an ES module, and
 * reaching for it throws before a single story is read.
 */
const here = dirname(fileURLToPath(import.meta.url));
const r = (...p: string[]) => resolve(here, '..', ...p);

/**
 * The storybook.
 *
 * It builds the renderer the way `electron.vite.config.ts` does — the same
 * aliases, the same Tailwind plugin — because a component rendered under
 * different resolution rules is a component you are not actually reviewing.
 * What it deliberately does *not* build is the main or host process: nothing
 * here has a Node API, and `window.shelf` is a fake (`mocks/shelf.ts`).
 *
 * `@drivers` resolves to types only. The renderer never imports a driver — the
 * architecture rule — and neither do the stories; the alias is here because
 * component props are typed with `Row`, `Field` and `Capabilities`.
 */
const config: StorybookConfig = {
  stories: ['../src/renderer/**/*.stories.@(ts|tsx)', '../.storybook/**/*.mdx'],

  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],

  framework: {
    name: '@storybook/vue3-vite',
    options: {},
  },

  core: { disableTelemetry: true },

  /*
   * Merged rather than rebuilt. Returning a fresh object drops what the
   * framework put there — including `@vitejs/plugin-vue`, without which every
   * `<script setup lang="ts">` is parsed as plain JavaScript and the build
   * fails on the first component it reads.
   */
  viteFinal: (viteConfig) =>
    mergeConfig(viteConfig, {
      /*
       * Both plugins named here, and the Vue one is not optional.
       *
       * The framework picks up `@vitejs/plugin-vue` from the project's own
       * `vite.config.ts` — which this project does not have; its build is
       * `electron.vite.config.ts`, which Vite does not look for. Without this
       * every `<script setup>` is parsed as plain JavaScript and the build
       * dies on the first component it reads.
       */
      plugins: [vue(), tailwindcss()],
      resolve: {
        alias: {
          '@renderer': r('src/renderer'),
          '@shared': r('src/shared'),
          '@drivers': r('src/drivers'),
        },
      },
    }),
};

export default config;
