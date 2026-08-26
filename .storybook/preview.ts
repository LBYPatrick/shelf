import { createPinia, setActivePinia } from 'pinia';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import { setup, type Preview } from '@storybook/vue3-vite';
import { changeLocale, type LocaleId } from '@renderer/i18n';
import { useTheme } from '@renderer/composables/useTheme';
import { applyTheme, type Density, type ThemeMode } from '@renderer/styles/theme';
import en from '@renderer/i18n/locales/en-US.json';
import ja from '@renderer/i18n/locales/ja.json';
import ko from '@renderer/i18n/locales/ko.json';
import vi from '@renderer/i18n/locales/vi.json';
import zh from '@renderer/i18n/locales/zh-CN.json';
import '@renderer/styles/tailwind.css';
import { installShelf, resetShelf } from './mocks/shelf';
import { installHost, resetHost } from './mocks/host';

/**
 * What every story gets before it renders.
 *
 * A component here needs three things the app would otherwise have given it: a
 * bridge to the outside world, a store, and a language. All three are installed
 * centrally rather than per story, because a story that has to remember to set
 * them up is a story that will be written wrong.
 *
 * The bridge and the host client are installed first and once, because several
 * stores read `window.shelf` while they are being constructed. Pinia is new per
 * story — the stores hold open tabs, a filter, a conversation, and those must
 * not leak from one story into the next.
 */
installShelf();
installHost();

// i18next is a singleton and the resources never change; the language is
// switched per story through the toolbar rather than by re-initialising it.
void i18next.init({
  lng: 'en-US',
  fallbackLng: 'en-US',
  resources: {
    'en-US': { translation: en },
    ja: { translation: ja },
    'zh-CN': { translation: zh },
    ko: { translation: ko },
    vi: { translation: vi },
  },
  interpolation: { escapeValue: false },
  returnEmptyString: false,
});

setup((app) => {
  app.use(I18NextVue, { i18next });
});

const MODES: readonly ThemeMode[] = ['light', 'dark'];
const DENSITIES: readonly Density[] = ['compact', 'default', 'comfortable'];

const preview: Preview = {
  parameters: {
    /*
     * Off. The app paints its own surfaces and the root is deliberately
     * transparent — an addon painting a colour behind everything would hide
     * exactly the bug that rule exists to prevent.
     */
    backgrounds: { disable: true },
    controls: { expanded: true, matchers: { color: /(background|colou?r)$/i } },
    a11y: { test: 'todo' },
    docs: { toc: true },
  },

  globalTypes: {
    theme: {
      description: 'Appearance',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: MODES.map((mode) => ({ value: mode, title: mode })),
        dynamicTitle: true,
      },
    },
    density: {
      description: 'Density',
      toolbar: {
        title: 'Density',
        icon: 'component',
        items: DENSITIES.map((value) => ({ value, title: value })),
        dynamicTitle: true,
      },
    },
    locale: {
      description: 'Language',
      toolbar: {
        title: 'Language',
        icon: 'globe',
        items: [
          { value: 'en-US', title: 'English' },
          { value: 'ja', title: '日本語' },
          { value: 'zh-CN', title: '简体中文' },
          { value: 'ko', title: '한국어' },
          { value: 'vi', title: 'Tiếng Việt' },
        ],
        dynamicTitle: true,
      },
    },
  },

  initialGlobals: { theme: 'light', density: 'default', locale: 'en-US' },

  decorators: [
    (story, context) => {
      setActivePinia(createPinia());
      resetShelf();
      resetHost();

      void changeLocale(context.globals['locale'] as LocaleId);

      const theme = useTheme();
      theme.mode = context.globals['theme'] as ThemeMode;
      theme.density = context.globals['density'] as Density;

      /*
       * Applied to the document, never to a wrapper. The tokens live on
       * `:root`, and scoping them to a div would be a different environment
       * from the one the app runs in — which is the one worth reviewing.
       */
      applyTheme(document.documentElement, {
        seed: theme.accent,
        appearance: context.globals['theme'] === 'dark' ? 'dark' : 'light',
        density: theme.density,
        materials: theme.materials,
      });

      return { components: { Story: story() }, template: '<Story />' };
    },
  ],
};

export default preview;
