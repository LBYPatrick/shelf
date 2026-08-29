import { describe, expect, it } from 'vitest';
import { ACCENT_PRESETS, accentId, accentSeed, readAccent } from '@shared/accents';

/**
 * The accent is stored as the name of the thing that was chosen.
 *
 * The interface offers eight decided colours and no free colour well, so the
 * only accents that can exist are these eight — and a file that kept three
 * numbers was keeping a value that could be anything to hold one that could
 * only ever be one of eight.
 */

describe('an accent by name', () => {
  it('round-trips every preset the interface offers', () => {
    for (const preset of ACCENT_PRESETS) {
      expect(accentSeed(preset.id)).toEqual(preset.seed);
      expect(accentId(preset.seed)).toBe(preset.id);
    }
  });

  it('knows nothing of a colour it has no swatch for', () => {
    expect(accentSeed('chartreuse')).toBeUndefined();
    expect(accentId({ l: 0.5, c: 0.2, h: 30 })).toBeUndefined();
  });
});

describe('reading a stored accent', () => {
  it('takes the name a current build writes', () => {
    expect(readAccent('green')).toEqual(accentSeed('green'));
  });

  /*
   * The shape older builds wrote. It recovers exactly, because only a preset
   * could ever have set those numbers in the first place.
   */
  it('takes the triple an older build wrote', () => {
    const green = accentSeed('green')!;
    expect(readAccent({ ...green })).toEqual(green);
  });

  /*
   * `undefined` rather than a guess, so every caller falls back to what is
   * already in force. A hand-edited file asking for a colour with no swatch
   * must not put the window into a state the interface cannot show as chosen.
   */
  it('gives back nothing it cannot name', () => {
    for (const asked of [
      'chartreuse',
      '',
      42,
      null,
      undefined,
      {},
      { l: 1 },
      [],
      { l: 0.5, c: 0.2, h: 30 },
    ]) {
      expect(readAccent(asked), `${JSON.stringify(asked)}`).toBeUndefined();
    }
  });
});
