/**
 * The accents the interface offers, and the names they are stored under.
 *
 * Here rather than beside the colour maths, for the same reason the syntax
 * schemes are here: `settingsFile.ts` has to recognise what a document names,
 * and `shared` is the only place both it and the renderer can read from. The
 * derivation that turns one of these into a whole palette stays in
 * `renderer/styles/theme.ts` — that is drawing, and this is a list.
 */

import type { Oklch } from './color';

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

/**
 * The accent, stored as the name of the thing that was chosen.
 *
 * It used to be persisted as its three numbers, which is the shape the
 * derivation wants and the wrong shape to keep: the interface offers eight
 * decided colours and no free well, so a triple in the file is a value that
 * could be anything holding a value that can only be one of eight. `"blue"`
 * says what was picked; `{ l: 0.6, c: 0.21, h: 250 }` says what it happened to
 * compute to, and invites a hand-edited settings file to ask for a colour the
 * app has no name for.
 *
 * Both shapes are read, because a file written by an older build is a file
 * somebody still has. The triple recovers its id exactly — only a preset could
 * ever have set it — and anything unrecognisable falls back rather than
 * failing, which is the same courtesy every other value in that document gets.
 */
export function accentId(seed: Oklch): string | undefined {
  return ACCENT_PRESETS.find(
    (preset) => preset.seed.l === seed.l && preset.seed.c === seed.c && preset.seed.h === seed.h
  )?.id;
}

export function accentSeed(id: string): Oklch | undefined {
  return ACCENT_PRESETS.find((preset) => preset.id === id)?.seed;
}

/** An accent out of a stored document, in either shape it has ever been kept in. */
export function readAccent(incoming: unknown): Oklch | undefined {
  if (typeof incoming === 'string') return accentSeed(incoming);

  // The older shape. Matched rather than trusted: the numbers are only
  // meaningful if they are a preset's, and a file claiming some other triple is
  // asking for a colour that has no swatch to show it as chosen.
  if (typeof incoming === 'object' && incoming !== null) {
    const { l, c, h } = incoming as Record<string, unknown>;
    if (typeof l === 'number' && typeof c === 'number' && typeof h === 'number') {
      return accentSeed(accentId({ l, c, h }) ?? '');
    }
  }

  return undefined;
}
