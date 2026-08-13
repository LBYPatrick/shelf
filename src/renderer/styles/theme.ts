/**
 * The accent system.
 *
 * One seed colour in OKLCH derives the entire palette. OKLCH is what makes this
 * work: its lightness axis is perceptually uniform, so "the same colour, 4%
 * lighter" is a real, predictable step at every hue, which it is not in HSL.
 *
 * The derived values are written as inline custom properties on <html>. daisyUI
 * emits its theme under a `[data-theme]` selector, so inline properties outrank
 * it and the two systems compose rather than compete.
 */

import { contrastRatio, type Oklch } from '@shared/color';

export type { Oklch };

export type ThemeMode = 'system' | 'light' | 'dark';
export type Appearance = 'light' | 'dark';
export type Density = 'compact' | 'default' | 'comfortable';

export interface AccentPreset {
  readonly id: string;
  readonly name: string;
  readonly seed: Oklch;
}

/**
 * Presets sit at a lightness that reads as the same weight across hues, rather
 * than at a fixed chroma, which would make yellow scream and blue whisper.
 */
export const ACCENT_PRESETS: readonly AccentPreset[] = [
  { id: 'blue', name: 'Blue', seed: { l: 0.6, c: 0.21, h: 250 } },
  { id: 'purple', name: 'Purple', seed: { l: 0.57, c: 0.23, h: 300 } },
  { id: 'pink', name: 'Pink', seed: { l: 0.63, c: 0.21, h: 355 } },
  { id: 'red', name: 'Red', seed: { l: 0.58, c: 0.21, h: 25 } },
  { id: 'orange', name: 'Orange', seed: { l: 0.68, c: 0.18, h: 55 } },
  { id: 'yellow', name: 'Yellow', seed: { l: 0.79, c: 0.16, h: 90 } },
  { id: 'green', name: 'Green', seed: { l: 0.65, c: 0.17, h: 150 } },
  { id: 'graphite', name: 'Graphite', seed: { l: 0.55, c: 0.02, h: 250 } },
];

export const DEFAULT_ACCENT = ACCENT_PRESETS[0]!.seed;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function oklch({ l, c, h }: Oklch): string {
  const lightness = (clamp(l, 0, 1) * 100).toFixed(2);
  const chroma = clamp(c, 0, 0.4).toFixed(4);
  const hue = ((h % 360) + 360) % 360;
  return `oklch(${lightness}% ${chroma} ${hue.toFixed(1)})`;
}

/** Body text needs 4.5:1; a UI component only needs to be locatable, so 3:1. */
const TEXT_CONTRAST = 4.5;
const UI_CONTRAST = 3;

/**
 * Foreground for text sitting on the accent. Both candidates carry a trace of
 * the accent hue so they do not read as a foreign black or white dropped onto a
 * saturated field, and the winner is *measured* rather than guessed from a
 * lightness threshold — thresholds are wrong for yellows and cyans, which are
 * far brighter than their lightness suggests.
 */
function contentFor(accent: Oklch): Oklch {
  const light: Oklch = { l: 0.99, c: 0, h: accent.h };
  const dark: Oklch = { l: 0.16, c: Math.min(accent.c * 0.25, 0.04), h: accent.h };

  /*
   * White wins ties and near-ties rather than losing them.
   *
   * Picking whichever side measures higher is defensible arithmetic and gives
   * the wrong answer: a mid-blue measures 3.8:1 against white and 5.0:1 against
   * near-black, so the button, the selected menu row and the autocomplete
   * highlight all came out navy-on-blue. That clears AA and still looks wrong,
   * because a saturated field carries far less apparent contrast than its ratio
   * suggests — which is why a filled accent control is white-on-colour on every
   * Apple platform, and the colour moves when it has to.
   *
   * So white is used whenever it is legible at all, and `usableAccent` below
   * darkens the accent to *make* it legible before this ever has to fall back.
   */
  if (contrastRatio(light, accent) >= TEXT_CONTRAST) return light;
  if (contrastRatio(dark, accent) >= TEXT_CONTRAST) return dark;
  return contrastRatio(light, accent) >= contrastRatio(dark, accent) ? light : dark;
}

/**
 * Make an accent usable, whatever the user picked.
 *
 * The accent has two jobs it must do at every hue: stand out from the page, and
 * carry legible text. A raw seed often fails one of them — a yellow at its most
 * vivid vanishes against a white page, and a mid-blue is too light for white
 * text and too dark for black. So we walk the lightness away from the page
 * until both hold, keeping hue and chroma so it still reads as the colour the
 * user chose.
 *
 * This is what lets the accent picker offer a free colour well instead of eight
 * safe presets.
 */
function usableAccent(seed: Oklch, surface: Oklch): Oklch {
  const away = surface.l > 0.5 ? -1 : 1;
  const STEP = 0.01;
  const STEPS = 70;

  /*
   * How far the accent may travel to keep white text on it.
   *
   * Beyond about this much lightness the result stops being the colour that was
   * chosen — a yellow dark enough to carry white is olive — so past the bound
   * we stop moving the colour and let `contentFor` darken the text instead.
   * Apple does the same: its blue button is white-on-blue, its yellow one is
   * black-on-yellow.
   */
  const WHITE_TEXT_REACH = 0.12;
  const white: Oklch = { l: 0.99, c: 0, h: seed.h };

  /*
   * First pass: try to keep white text, by moving the accent rather than the
   * text. This has to run to completion before the general search below, which
   * would otherwise accept the untouched seed on its first iteration the moment
   * a darkened *foreground* satisfies it.
   */
  for (let i = 0; i <= STEPS; i += 1) {
    const l = clamp(seed.l + away * STEP * i, 0.06, 0.97);
    if (Math.abs(l - seed.l) > WHITE_TEXT_REACH) break;

    const candidate: Oklch = { ...seed, l };
    if (
      contrastRatio(candidate, surface) >= UI_CONTRAST &&
      contrastRatio(white, candidate) >= TEXT_CONTRAST
    ) {
      return candidate;
    }
  }

  let bestCandidate = seed;
  let bestScore = -Infinity;

  for (let i = 0; i <= STEPS; i += 1) {
    const l = clamp(seed.l + away * STEP * i, 0.06, 0.97);
    const candidate: Oklch = { ...seed, l };

    const againstPage = contrastRatio(candidate, surface);
    const forText = contrastRatio(contentFor(candidate), candidate);

    if (againstPage >= UI_CONTRAST && forText >= TEXT_CONTRAST) return candidate;

    // Track the least-bad option so a hue that cannot satisfy both still gets
    // the closest available answer rather than the untouched seed.
    const score = Math.min(againstPage / UI_CONTRAST, forText / TEXT_CONTRAST);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }

    if (l <= 0.06 || l >= 0.97) break;
  }

  return bestCandidate;
}

/**
 * Neutral surfaces carry a trace of the accent hue. It is small enough that
 * nobody would call the interface "blue", and large enough that switching the
 * accent feels like a new theme rather than a repainted button.
 */
const NEUTRAL_TINT = 0.006;

/**
 * The palette as data. Exposed so contrast can be measured directly in tests
 * rather than by parsing the CSS we happen to emit.
 */
export interface Palette {
  readonly base100: Oklch;
  readonly base200: Oklch;
  readonly base300: Oklch;
  readonly baseContent: Oklch;
  readonly neutral: Oklch;
  readonly primary: Oklch;
  readonly primaryContent: Oklch;
  readonly subtle: Oklch;
}

function rampFor(seed: Oklch, appearance: Appearance): Omit<Palette, 'primaryContent'> {
  const h = seed.h;

  if (appearance === 'dark') {
    return {
      base100: { l: 0.21, c: NEUTRAL_TINT * 1.3, h },
      base200: { l: 0.175, c: NEUTRAL_TINT * 1.3, h },
      base300: { l: 0.27, c: NEUTRAL_TINT * 1.6, h },
      baseContent: { l: 0.93, c: NEUTRAL_TINT, h },
      neutral: { l: 0.34, c: NEUTRAL_TINT * 2, h },
      // Saturated colours lose contrast against dark surfaces, so the accent
      // starts lifted and slightly desaturated rather than at its seed value.
      primary: { l: Math.min(seed.l + 0.1, 0.86), c: seed.c * 0.82, h },
      subtle: { l: 0.28, c: seed.c * 0.35, h },
    };
  }

  return {
    base100: { l: 0.99, c: NEUTRAL_TINT * 0.5, h },
    base200: { l: 0.965, c: NEUTRAL_TINT * 0.7, h },
    base300: { l: 0.93, c: NEUTRAL_TINT, h },
    baseContent: { l: 0.24, c: NEUTRAL_TINT * 2, h },
    neutral: { l: 0.46, c: NEUTRAL_TINT * 2.3, h },
    primary: seed,
    subtle: { l: 0.92, c: seed.c * 0.35, h },
  };
}

/**
 * The full set of custom properties for a given accent and appearance. Returned
 * as a plain map so it can be applied to an element, diffed in a test, or run
 * through a contrast checker without touching the DOM.
 */
export function buildPalette(seed: Oklch, appearance: Appearance): Palette {
  const ramp = rampFor(seed, appearance);
  const primary = usableAccent(ramp.primary, ramp.base100);
  return { ...ramp, primary, primaryContent: contentFor(primary) };
}

export function themeVariables(seed: Oklch, appearance: Appearance): Record<string, string> {
  const ramp = buildPalette(seed, appearance);
  const accent = ramp.primary;
  const accentContent = ramp.primaryContent;

  return {
    '--color-base-100': oklch(ramp.base100),
    '--color-base-200': oklch(ramp.base200),
    '--color-base-300': oklch(ramp.base300),
    '--color-base-content': oklch(ramp.baseContent),
    '--color-neutral': oklch(ramp.neutral),
    '--color-neutral-content': oklch(
      appearance === 'dark' ? ramp.baseContent : { l: 0.99, c: 0, h: seed.h }
    ),

    '--color-primary': oklch(accent),
    '--color-primary-content': oklch(accentContent),
    '--color-accent': oklch(accent),
    '--color-accent-content': oklch(accentContent),
    '--color-secondary': oklch({ l: accent.l, c: accent.c * 0.4, h: accent.h }),
    '--color-secondary-content': oklch(accentContent),

    // Shelf-specific tokens the daisyUI theme has no equivalent for.
    '--accent-hover': oklch({ ...accent, l: clamp(accent.l + 0.04, 0, 1) }),
    '--accent-press': oklch({ ...accent, l: clamp(accent.l - 0.04, 0, 1) }),
    '--accent-subtle': oklch(ramp.subtle),
    '--accent-hue': String(Math.round(seed.h)),
  };
}

/** Resolve a stored mode against the OS setting. */
export function resolveAppearance(mode: ThemeMode, systemPrefersDark: boolean): Appearance {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light';
  return mode;
}

export function applyTheme(
  root: HTMLElement,
  options: { seed: Oklch; appearance: Appearance; density: Density }
): void {
  const { seed, appearance, density } = options;

  root.dataset['theme'] = appearance === 'dark' ? 'shelf-dark' : 'shelf-light';
  root.dataset['density'] = density;
  root.style.colorScheme = appearance;

  for (const [property, value] of Object.entries(themeVariables(seed, appearance))) {
    root.style.setProperty(property, value);
  }
}
