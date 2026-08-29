import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FRAMEWORK_COMPONENTS, FRAMEWORK_UTILITIES } from '../frameworkClasses';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * A class the template names has to be a class the stylesheets define.
 *
 * Only the BEM ones — anything with `__` or `--` — because those are ours
 * without exception, where a bare word might be a utility from Tailwind or a
 * hook a test holds on to. That narrowing is what makes the check quiet enough
 * to be worth having.
 *
 * It exists because the same mistake has now shipped twice, both times from a
 * rename that took the block and left its parts behind. The tab strip's open
 * tab was styled `.tab--on` while the template wrote `striptab--on`, so every
 * tab looked identical; the context menu's rows were `.popmenu__item` against a
 * template still writing `menu__item`, so the menu rendered as a pile of
 * overlapping text. Neither is visible to the compiler and both look like a
 * design decision until someone says otherwise.
 */
function sources(pattern: string): string[] {
  return globSync(pattern, { cwd: root }).map((file) => join(root, file));
}

const VUE_FILES = sources('src/renderer/**/*.vue');
const CSS_FILES = sources('src/renderer/styles/*.css');

/** Every class selector defined anywhere, scoped blocks included. */
function definedClasses(): Set<string> {
  const defined = new Set<string>();

  const collect = (css: string) => {
    for (const [, name] of css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) defined.add(name!);
  };

  for (const file of CSS_FILES) collect(readFileSync(file, 'utf8'));

  for (const file of VUE_FILES) {
    const source = readFileSync(file, 'utf8');
    for (const [, block] of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
      collect(block!);
    }
  }

  return defined;
}

/** Every BEM class a template asks for, with the file that asked. */
function usedClasses(): { file: string; name: string }[] {
  const used: { file: string; name: string }[] = [];

  for (const file of VUE_FILES) {
    const source = readFileSync(file, 'utf8');
    const template = source.slice(source.indexOf('<template>'));
    const where = relative(root, file);

    const add = (name: string) => {
      // Interpolated names cannot be resolved from the source, so they are the
      // one thing this cannot check.
      if (name.includes('${')) return;
      used.push({ file: where, name });
    };

    for (const [, value] of template.matchAll(/\sclass="([^"]*)"/g)) {
      for (const name of value!.split(/\s+/)) if (name) add(name);
    }

    // Object syntax: `:class="{ 'a--b': cond }"`.
    for (const [, value] of template.matchAll(/:class="([^"]*)"/g)) {
      for (const [, name] of value!.matchAll(/'([^']+)'/g)) add(name!);
    }
  }

  return used;
}

describe('class names', () => {
  it('defines every BEM class the templates use', () => {
    const defined = definedClasses();
    const orphans = usedClasses()
      // Only the BEM ones here: a bare word may be a Tailwind utility or a hook
      // a test holds on to, and neither is defined in a stylesheet of ours.
      .filter((entry) => /(__|--)/.test(entry.name))
      .filter((entry) => !defined.has(entry.name))
      .map((entry) => `${entry.file}: .${entry.name}`);

    expect([...new Set(orphans)]).toEqual([]);
  });

  /*
   * The gate has this rule already, and it looks at what is on screen.
   *
   * That is the right check and it cannot be the only one, because a surface it
   * never opens is a surface it never sees. The CLI sign-in sheet opens for one
   * state — a command-line assistant nobody is signed in to — and it wore
   * `.steps` and `.step` for as long as it existed: daisyUI drew its own
   * numbered circles down the far side of the sheet and centred every line
   * between the two sets of them, and nothing failed.
   *
   * Reading the templates catches it wherever it is, opened or not. It is the
   * same list the gate uses, kept in one place, because two lists is one list
   * that falls behind.
   */
  it('takes no framework component or utility class name', () => {
    const theirs = new Set([...FRAMEWORK_COMPONENTS, ...FRAMEWORK_UTILITIES]);
    const taken = usedClasses()
      .filter((entry) => theirs.has(entry.name))
      .map((entry) => `${entry.file}: .${entry.name}`);

    expect([...new Set(taken)]).toEqual([]);
  });

  it('is looking at something', () => {
    // A glob that quietly matched nothing would pass the check above forever.
    expect(VUE_FILES.length).toBeGreaterThan(20);
    expect(usedClasses().length).toBeGreaterThan(50);
  });
});
