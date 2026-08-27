import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every component a template names is a component the script imported.
 *
 * This is `vue/no-undef-components`, which left with ESLint. Nothing is
 * registered globally here, so a component the template names but the script
 * never imported renders as *nothing at all* — no warning, no error, no
 * element. That is how the Export sheet shipped unopenable, and it is the one
 * rule the replacement linter has no equivalent for: oxlint reads a `.vue`
 * file's script and does not look inside its template, and the typechecker
 * does not see the tag either. Measured both ways before this was written.
 *
 * A parser would be the thorough answer and a regex is the honest one: the
 * question is only "does this PascalCase tag have a matching import", and both
 * halves are lexical. What it cannot do is understand a component held in a
 * variable and rendered through `<component :is>`, which is why that form is
 * exempted rather than guessed at.
 */

const ROOT = resolve(__dirname, '../../src');

/** Vue's own, plus the ones the compiler resolves without an import. */
const BUILT_IN = new Set([
  'Component',
  'KeepAlive',
  'Suspense',
  'Teleport',
  'Transition',
  'TransitionGroup',
]);

function vueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return vueFiles(path);
    return path.endsWith('.vue') ? [path] : [];
  });
}

/** The template block, which is where a component can be named. */
function template(source: string): string {
  const at = source.indexOf('<template>');
  return at === -1 ? '' : source.slice(at);
}

function script(source: string): string {
  const at = source.indexOf('<template>');
  return at === -1 ? source : source.slice(0, at);
}

/**
 * `<PascalCase`, and only that.
 *
 * A kebab-case tag is an HTML element as far as this is concerned, and an
 * `is=` binding names its component at runtime — neither is a lexical
 * reference this can check.
 */
function used(source: string): string[] {
  const names = new Set<string>();
  for (const match of template(source).matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g)) {
    names.add(match[1]!);
  }
  return [...names];
}

describe('every component a template names', () => {
  const files = vueFiles(ROOT);

  it('finds the components to check', () => {
    // A path that stops matching would make this suite pass by looking at
    // nothing, which is the failure mode a file sweep has.
    expect(files.length).toBeGreaterThan(50);
  });

  it('is one the script brought into scope', () => {
    const missing: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const head = script(source);

      for (const name of used(source)) {
        if (BUILT_IN.has(name)) continue;
        // An import, a local `const`, or a `defineComponent` — anything that
        // puts the name in the setup scope the template is compiled against.
        const declared = new RegExp(`\\b${name}\\b`).test(head);
        if (!declared) missing.push(`${file.slice(ROOT.length + 1)}: <${name}>`);
      }
    }

    expect(missing, 'a component used but never imported renders as nothing').toEqual([]);
  });
});
