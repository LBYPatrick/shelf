import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { i18next, resolveLocale, setupI18n } from './i18n';
import { connectToHost } from './lib/bootstrap';
import { useToasts } from './stores/toasts';
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

  /*
   * The process that holds every open database can die, and until now the only
   * sign was a line in a console nobody has open. The interface simply stopped
   * answering.
   */
  const toasts = useToasts();

  connectToHost((permanent) => {
    toasts.show({
      id: 'host-lost',
      tone: permanent ? 'error' : 'warning',
      title: i18next.t(permanent ? 'host.unavailableTitle' : 'host.restartedTitle'),
      message: i18next.t(permanent ? 'host.unavailable' : 'host.restarted'),
      ...(permanent ? {} : { expire: 8000 }),
    });
  });
}

void start();
