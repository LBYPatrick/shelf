import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The motion vocabulary is declared once and referred to everywhere else.
 *
 * It was not. `--ease-sheet` was declared in `base.css` and referenced *zero*
 * times, while its literal — `cubic-bezier(0.32, 0.72, 0, 1)` — was written out
 * by hand at twenty-two call sites across fourteen files: the sheet, the tab
 * strip, the sidebar, every menu, the toggle, the segmented control. They all
 * agreed, and they agreed by coincidence. The first person to tune one of them
 * would have made the app move two ways.
 *
 * This is the same fault the surfaces had — `--surface-well` and
 * `--surface-raised` exist because the query editor and the assistant's
 * transcript were each spelled `--fill-4` at their own call sites — and the
 * same fault the column widths had. Twice was enough to write a rule; three
 * times is enough to have the gate hold it.
 *
 * Durations are checked the same way and for the same reason, with one
 * difference: a duration is a plain number, so this only looks at the ones
 * sitting inside a `transition` or `animation`. A `120ms` somewhere else is not
 * necessarily motion.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Where the vocabulary lives. The only file allowed to write the values out. */
const DECLARATION = 'src/renderer/styles/base.css';

function styleSources(): { file: string; css: string }[] {
  const out: { file: string; css: string }[] = [];

  const add = (path: string, css: string) => {
    const where = relative(root, path);
    if (where === DECLARATION) return;
    out.push({ file: where, css });
  };

  for (const file of globSync('src/renderer/**/*.css', { cwd: root })) {
    add(join(root, file), readFileSync(join(root, file), 'utf8'));
  }

  for (const file of globSync('src/renderer/**/*.vue', { cwd: root })) {
    const source = readFileSync(join(root, file), 'utf8');
    for (const [, block] of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
      add(join(root, file), block!);
    }
  }

  return out;
}

describe('the motion vocabulary', () => {
  it('is looking at something', () => {
    // A glob that quietly matched nothing would pass everything below forever.
    const sources = styleSources();
    expect(sources.length).toBeGreaterThan(30);
    expect(sources.some(({ css }) => css.includes('var(--ease-'))).toBe(true);
  });

  it('declares every curve once, and nowhere writes one out', () => {
    const strays = styleSources().flatMap(({ file, css }) =>
      [...css.matchAll(/cubic-bezier\([^)]*\)/g)].map((match) => `${file}: ${match[0]}`)
    );

    expect([...new Set(strays)]).toEqual([]);
  });

  /*
   * Interaction timings only, and the boundary is deliberate.
   *
   * The scale is about how long the interface takes to answer somebody, so it
   * governs everything a person waits through — and nothing else. A shimmer
   * looping every 1.6 seconds, a ring turning once a second, a highlight
   * decaying over 900ms: none of those is a response, none of them is on this
   * scale, and forcing them onto it would either make the scale meaningless or
   * make the loops wrong. Half a second is comfortably above the longest
   * response worth having and below the shortest loop here.
   *
   * Reduced motion is exempt for the same reason from the other direction: its
   * durations are deliberately shorter than any step, because the point there
   * is to be over quickly rather than to be legible.
   */
  const INTERACTION_CEILING_MS = 500;

  function milliseconds(value: string): number {
    const amount = Number.parseFloat(value);
    return value.endsWith('ms') ? amount : amount * 1000;
  }

  /** Everything outside a `prefers-reduced-motion` block. */
  function withoutReducedMotion(css: string): string {
    const out: string[] = [];
    let at = 0;

    for (;;) {
      const start = css.indexOf('@media (prefers-reduced-motion', at);
      if (start === -1) break;
      out.push(css.slice(at, start));

      // Past the matching close brace, counting the nested ones on the way.
      let depth = 0;
      let cursor = css.indexOf('{', start);
      if (cursor === -1) break;
      for (; cursor < css.length; cursor += 1) {
        if (css[cursor] === '{') depth += 1;
        else if (css[cursor] === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      at = cursor + 1;
    }

    out.push(css.slice(at));
    return out.join('\n');
  }

  it('times every interaction from the scale', () => {
    const scale = readFileSync(join(root, DECLARATION), 'utf8');
    const known = new Set(
      [...scale.matchAll(/--t-[\w-]+:\s*([\d.]+m?s)/g)].map((match) => match[1]!)
    );
    expect(known.size).toBeGreaterThan(3);

    const strays = styleSources().flatMap(({ file, css }) =>
      [
        ...withoutReducedMotion(css).matchAll(/(?:transition|animation)(?:-duration)?:[^;}]*/g),
      ].flatMap((rule) =>
        [...rule[0].matchAll(/(?<![\w-])(\d+(?:\.\d+)?m?s)(?![\w-])/g)]
          .map((match) => match[1]!)
          .filter((value) => {
            const ms = milliseconds(value);
            return ms > 0 && ms < INTERACTION_CEILING_MS && !known.has(value);
          })
          .map((value) => `${file}: ${value}`)
      )
    );

    expect([...new Set(strays)]).toEqual([]);
  });
});
