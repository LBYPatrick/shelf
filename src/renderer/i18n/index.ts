import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import type { App } from 'vue';
import en from './locales/en-US.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import vi from './locales/vi.json';
import zh from './locales/zh-CN.json';

/**
 * Languages.
 *
 * English is the source of truth: every other file is checked against its key
 * set in the tests, so a string added here without a translation is a failure
 * rather than an English word appearing unannounced in a Japanese interface.
 */
export const LOCALES = [
  { id: 'en-US', label: 'English', endonym: 'English' },
  { id: 'ja', label: 'Japanese', endonym: '日本語' },
  { id: 'zh-CN', label: 'Chinese (Simplified)', endonym: '简体中文' },
  { id: 'ko', label: 'Korean', endonym: '한국어' },
  { id: 'vi', label: 'Vietnamese', endonym: 'Tiếng Việt' },
] as const;

export type LocaleId = (typeof LOCALES)[number]['id'];

/** `system` follows the operating system; anything else is an explicit choice. */
export type LanguagePreference = 'system' | LocaleId;

const RESOURCES = {
  'en-US': { translation: en },
  ja: { translation: ja },
  'zh-CN': { translation: zh },
  ko: { translation: ko },
  vi: { translation: vi },
};

/**
 * Maps an OS locale onto one we ship.
 *
 * The system reports things like `ja-JP`, `zh-Hans-CN` or `en-GB`; matching the
 * language subtag is what makes "follow system" work for people whose region is
 * not the one we happened to name the file after.
 */
export function resolveLocale(preference: LanguagePreference, systemLocale: string): LocaleId {
  if (preference !== 'system') return preference;

  const normalised = systemLocale.toLowerCase();
  const exact = LOCALES.find((locale) => locale.id.toLowerCase() === normalised);
  if (exact) return exact.id;

  const language = normalised.split('-')[0];
  if (language === 'zh') return 'zh-CN';
  if (language === 'ja') return 'ja';
  if (language === 'ko') return 'ko';
  if (language === 'vi') return 'vi';

  return 'en-US';
}

/**
 * Translates an engine's own word for something.
 *
 * Drivers report their nouns in English — "collection", "keyspace", "item" —
 * because that is what the engine calls them. Interpolating those straight into
 * a Japanese sentence reads badly, so they are looked up, and anything not
 * recognised falls through unchanged rather than disappearing.
 *
 * Not reactive: inside a component use the `t` from `useTranslation()`, or the
 * result will keep whichever language it was first evaluated in.
 */
export function translateNoun(noun: string): string {
  const key = `noun.${noun}`;
  const translated = i18next.t(key);
  return translated === key ? noun : translated;
}

export async function setupI18n(app: App, initial: LocaleId): Promise<void> {
  await i18next.init({
    lng: initial,
    fallbackLng: 'en-US',
    resources: RESOURCES,
    interpolation: {
      // Vue escapes what it renders; escaping again would show &amp; to the user.
      escapeValue: false,
    },
    returnEmptyString: false,
  });

  app.use(I18NextVue, { i18next });
}

export async function changeLocale(locale: LocaleId): Promise<void> {
  await i18next.changeLanguage(locale);
  document.documentElement.lang = locale;
}

export { i18next };
