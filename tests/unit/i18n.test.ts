import { describe, expect, it } from 'vitest';
import en from '@renderer/i18n/locales/en-US.json';
import ja from '@renderer/i18n/locales/ja.json';
import ko from '@renderer/i18n/locales/ko.json';
import vi from '@renderer/i18n/locales/vi.json';
import zh from '@renderer/i18n/locales/zh-CN.json';
import { resolveLocale } from '@renderer/i18n';

type Bundle = Record<string, Record<string, string>>;

const TRANSLATIONS: Record<string, Bundle> = {
  ja: ja as Bundle,
  'zh-CN': zh as Bundle,
  ko: ko as Bundle,
  vi: vi as Bundle,
};

function keysOf(bundle: Bundle): string[] {
  return Object.entries(bundle)
    .flatMap(([section, entries]) => Object.keys(entries).map((key) => `${section}.${key}`))
    .sort();
}

describe('translations', () => {
  const expected = keysOf(en as Bundle);

  for (const [locale, bundle] of Object.entries(TRANSLATIONS)) {
    describe(locale, () => {
      it('covers every key English has', () => {
        // A missing key would silently fall back to English mid-sentence.
        expect(keysOf(bundle)).toEqual(expected);
      });

      it('leaves no string empty', () => {
        for (const [section, entries] of Object.entries(bundle)) {
          for (const [key, value] of Object.entries(entries)) {
            expect(value.trim(), `${locale} ${section}.${key}`).not.toBe('');
          }
        }
      });

      it('keeps every interpolation placeholder', () => {
        const placeholders = (text: string) =>
          (text.match(/\{\{\s*\w+\s*\}\}/g) ?? [])
            .map((token) => token.replace(/\s/g, ''))
            .sort();

        for (const [section, entries] of Object.entries(en as Bundle)) {
          for (const [key, source] of Object.entries(entries)) {
            const translated = bundle[section]?.[key] ?? '';
            expect(placeholders(translated), `${locale} ${section}.${key}`).toEqual(
              placeholders(source)
            );
          }
        }
      });
    });
  }

  it('is actually translated, not copied English', () => {
    for (const [locale, bundle] of Object.entries(TRANSLATIONS)) {
      const identical = keysOf(bundle).filter((path) => {
        const [section, key] = path.split('.') as [string, string];
        return bundle[section]?.[key] === (en as Bundle)[section]?.[key];
      });

      // Some strings are legitimately the same everywhere — "Shelf", "Base64",
      // "NULL", "SSH agent" — but most must differ.
      expect(identical.length, `${locale} has ${identical.length} untranslated`).toBeLessThan(
        20
      );
    }
  });
});

describe('following the system locale', () => {
  it('matches on the language subtag, not the exact tag', () => {
    expect(resolveLocale('system', 'ja-JP')).toBe('ja');
    expect(resolveLocale('system', 'ko-KR')).toBe('ko');
    expect(resolveLocale('system', 'vi-VN')).toBe('vi');
    expect(resolveLocale('system', 'zh-Hans-CN')).toBe('zh-CN');
    expect(resolveLocale('system', 'zh-TW')).toBe('zh-CN');
  });

  it('falls back to English for anything unsupported', () => {
    expect(resolveLocale('system', 'de-DE')).toBe('en-US');
    expect(resolveLocale('system', 'en-GB')).toBe('en-US');
  });

  it('honours an explicit choice over the system', () => {
    expect(resolveLocale('ko', 'ja-JP')).toBe('ko');
  });
});
