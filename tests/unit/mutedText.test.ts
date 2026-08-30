import { describe, expect, it } from 'vitest';
import { oklchToSrgb, relativeLuminance, type Oklch, type Rgb } from '@shared/color';
import { ACCENT_PRESETS, buildPalette, type Appearance } from '@renderer/styles/theme';

/**
 * Secondary text has to be readable, and most of this app's text is secondary.
 *
 * Labels, hints, counts, timestamps, the line under a card — they are written as
 * `color-mix(in oklab, var(--color-base-content) N%, transparent)`, which is not
 * a *lighter colour*: it is the text colour at N% alpha, composited over
 * whatever surface it lands on. Two hundred call sites do that with
 * thirty-nine different values of N, which is the fill ramp's problem before
 * `--fill-1..4` existed — except this one has a WCAG consequence, because
 * WCAG 1.4.3 exempts decorative and disabled text and exempts nothing else.
 *
 * Measured in the workspace, the sidebar's counts and hints came out at 3.04:1
 * against a 4.5:1 requirement. So the safe alphas are named here and proved,
 * for every accent and both appearances — the same promise the accent picker
 * already makes about body text.
 */

const APPEARANCES: readonly Appearance[] = ['light', 'dark'];

/** What `color-mix(… N%, transparent)` actually paints, once it lands. */
function composite(text: Oklch, alpha: number, surface: Oklch): Rgb {
  const fg = oklchToSrgb(text);
  const bg = oklchToSrgb(surface);
  return {
    r: fg.r * alpha + bg.r * (1 - alpha),
    g: fg.g * alpha + bg.g * (1 - alpha),
    b: fg.b * alpha + bg.b * (1 - alpha),
  };
}

const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminanceOf = (c: Rgb) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);

function ratioOver(text: Oklch, alpha: number, surface: Oklch): number {
  const a = luminanceOf(composite(text, alpha, surface));
  const b = relativeLuminance(surface);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * The alpha `--text-soft` uses. Keep it in step with `base.css`; this test is
 * what stops the two drifting apart.
 *
 * The worst case across every accent and both appearances needs 63.5%, so 68%
 * is the shipped value with a little headroom — enough that a palette tweak
 * does not silently drop the whole app's secondary text below the line.
 */
const SOFT = 0.68;

describe('secondary text', () => {
  for (const appearance of APPEARANCES) {
    describe(appearance, () => {
      // The accent barely moves the neutrals, but it moves them, so every
      // preset is measured rather than the default one standing for all eight.
      for (const preset of ACCENT_PRESETS) {
        const palette = buildPalette(preset.seed, appearance);
        const surfaces = [palette.base100, palette.base200, palette.base300];

        it(`clears 4.5:1 at --text-soft on every surface (${preset.name})`, () => {
          for (const surface of surfaces) {
            expect(ratioOver(palette.baseContent, SOFT, surface)).toBeGreaterThanOrEqual(4.5);
          }
        });
      }
    });
  }

  /*
   * The values that were actually in the tree, kept as the reason the token
   * exists. 62% was the *most* generous of them and still misses; 45% was the
   * commonest. If either of these starts passing, the palette changed and the
   * note above is what is out of date, not the test.
   */
  it('records that the hand-mixed values did not clear it', () => {
    const palette = buildPalette(ACCENT_PRESETS[0]!.seed, 'light');
    expect(ratioOver(palette.baseContent, 0.62, palette.base300)).toBeLessThan(4.5);
    expect(ratioOver(palette.baseContent, 0.45, palette.base100)).toBeLessThan(4.5);
  });
});
