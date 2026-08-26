import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The controls whose popup the operating system draws.
 *
 * A `<select>` and a `<datalist>` look finished until they are opened, at which
 * point the OS takes over with its own focus ring, its own selection colour and
 * its own idea of where the list goes. `appearance: none` restyles the closed
 * control and leaves the open one native, which is worse: the app looks
 * finished right up to the click.
 *
 * There is a UI invariant that asks the same question, and it can only ask it
 * of what is on screen — it opened the settings sheet and found nothing, while
 * the import sheet three clicks away still had one. A component nobody has
 * opened is exactly where this hides, so the source is what gets read.
 */

const ROOT = 'src/renderer';
const FORBIDDEN = /<(select|datalist)[\s>]/;

/**
 * The file with its prose taken out.
 *
 * Both of these tags are *named* in the comments explaining why they are not
 * used, which is the sort of thing a naive grep reports as the very defect the
 * comment exists to describe.
 */
function markupOf(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function componentsUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return componentsUnder(path);
    return path.endsWith('.vue') ? [path] : [];
  });
}

describe('no control hands its popup to the engine to draw', () => {
  it('finds no native select or datalist anywhere in the interface', () => {
    const offenders = componentsUnder(ROOT).filter((path) =>
      FORBIDDEN.test(markupOf(readFileSync(path, 'utf8')))
    );

    // `SelectMenu` replaces the first and `SuggestInput` the second, and both
    // open the same `menulist`.
    expect(offenders).toEqual([]);
  });

  it('reads the components it claims to read', () => {
    // A sweep that silently walked an empty tree would pass forever.
    const components = componentsUnder(ROOT);
    expect(components.length).toBeGreaterThan(40);
    expect(components.some((path) => path.includes('SelectMenu.vue'))).toBe(true);
  });
});
