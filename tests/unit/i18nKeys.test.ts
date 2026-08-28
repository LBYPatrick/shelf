import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import en from '@renderer/i18n/locales/en-US.json';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * A key the interface asks for has to be a key the bundle has.
 *
 * The sibling check in `i18n.test.ts` compares the locales against English,
 * which catches a key translated in four languages and missing in the fifth. It
 * cannot catch the other direction: a key that exists in *no* locale, because
 * it was renamed, or decided against, or simply typed wrong. i18next does not
 * throw for one — it returns the key — so the button reads `assistant.test` and
 * the app looks half-finished in exactly one place.
 *
 * Which is how it shipped: the provider editor's Test button spent an afternoon
 * labelled `assistant.test`, because the key was moved to `action.test` and the
 * template was not. Nothing anywhere said so.
 *
 * Only literal keys are checked. A key built at run time — `noun.${name}`,
 * `settings.${id}` — is beyond a regular expression, and those call sites
 * already fall back deliberately.
 */
function sources(pattern: string): string[] {
  return globSync(pattern, { cwd: root }).map((file) => join(root, file));
}

const FILES = [...sources('src/renderer/**/*.vue'), ...sources('src/renderer/**/*.ts')];

type Bundle = Record<string, Record<string, string>>;

/**
 * The suffixes i18next appends to a plural key.
 *
 * A call site asks for `storage.amount` and the bundle holds `amount_one` and
 * `amount_other`; i18next picks between them from the `count` it was passed, so
 * the base key is real even though nothing in the file is spelled that way.
 * Without this, pluralising a string makes its own call site look missing.
 */
const PLURALS = /_(zero|one|two|few|many|other)$/;

function known(): Set<string> {
  const keys = new Set<string>();
  for (const [section, entries] of Object.entries(en as Bundle)) {
    for (const key of Object.keys(entries)) {
      keys.add(`${section}.${key}`);
      if (PLURALS.test(key)) keys.add(`${section}.${key.replace(PLURALS, '')}`);
    }
  }
  return keys;
}

/**
 * `$t('a.b')` and `t('a.b')`, in templates and in script.
 *
 * Deliberately narrow: a single-quoted literal of the form `section.key`.
 * Anything with a backtick, a variable, or no dot in it is a key this check has
 * no opinion about.
 */
const CALL = /\$?\bt\(\s*'([a-zA-Z][\w]*\.[\w]+)'/g;

describe('every translation key the interface asks for', () => {
  it('exists in the bundle', () => {
    const bundle = known();
    const missing: string[] = [];

    for (const file of FILES) {
      const source = readFileSync(file, 'utf8');
      for (const [, key] of source.matchAll(CALL)) {
        if (!bundle.has(key!)) missing.push(`${relative(root, file)}: ${key}`);
      }
    }

    expect([...new Set(missing)]).toEqual([]);
  });

  it('found some keys to check, so a broken pattern fails loudly', () => {
    // A regular expression that stops matching would make the test above pass
    // by examining nothing at all.
    const total = FILES.reduce(
      (count, file) => count + [...readFileSync(file, 'utf8').matchAll(CALL)].length,
      0
    );
    expect(total).toBeGreaterThan(100);
  });
});
