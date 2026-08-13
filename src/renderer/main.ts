import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { resolveLocale, setupI18n } from './i18n';
import { connectToHost } from './lib/bootstrap';
import './styles/tailwind.css';

/**
 * Startup order matters: the language has to be resolved before the first
 * render, or the interface would flash English and then re-translate itself.
 */
async function start(): Promise<void> {
  const app = createApp(App);
  app.use(createPinia());

  const [platform, stored] = await Promise.all([
    window.shelf.platformInfo(),
    window.shelf.db.getSetting<{ language?: string }>('preferences', {}),
  ]);

  const locale = resolveLocale((stored.language as never) ?? 'system', platform.locale);

  await setupI18n(app, locale);
  document.documentElement.lang = locale;

  app.mount('#app');

  connectToHost((permanent) => {
    console.error(permanent ? 'Connection host unavailable' : 'Connection host restarted');
  });
}

void start();
