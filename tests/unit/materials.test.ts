import { describe, expect, it } from 'vitest';
import type { Materials } from '@renderer/styles/theme';
import {
  CONTENT_ALPHA,
  DEFAULT_MATERIALS,
  DESIGNED_OPACITY,
  MATERIAL_LIMITS,
  alphaTransform,
  clampMaterials,
} from '@renderer/styles/theme';

/** The four material weights, as the stylesheet declares them. */
const WEIGHTS = [0.3, 0.45, 0.6, 0.78];

const alphaAt = (designed: number, opacity: number) => {
  const { scale, lift } = alphaTransform(opacity);
  return Math.min(1, Math.max(0, designed * scale + lift));
};

describe('the opacity dial', () => {
  it('leaves every material exactly as designed at the anchor', () => {
    for (const designed of WEIGHTS) {
      expect(alphaAt(designed, DESIGNED_OPACITY)).toBeCloseTo(designed, 10);
    }
  });

  /*
   * The pane covers most of the window, so it is what anyone reading the dial is
   * reading it about — and a control that says 20% while painting 36% is not a
   * control, it is a suggestion.
   */
  it('takes the working surface to the number the floor shows', () => {
    expect(alphaAt(CONTENT_ALPHA, MATERIAL_LIMITS.opacity.min)).toBeCloseTo(
      MATERIAL_LIMITS.opacity.min,
      10
    );
  });

  /*
   * And the reason the transform subtracts rather than scales. Scaling closes
   * the gaps between the surfaces as it thins them, so at the bottom of the
   * range the working pane and the columns beside it converge on the same
   * colour — which deletes the depth the three columns exist to express.
   */
  it('keeps every surface as far from its neighbour as it was designed to be', () => {
    const designedGap = CONTENT_ALPHA - 0.45;

    for (let step = 0; step <= 30; step += 1) {
      const opacity =
        MATERIAL_LIMITS.opacity.min +
        (step / 30) * (DESIGNED_OPACITY - MATERIAL_LIMITS.opacity.min);
      const pane = alphaAt(CONTENT_ALPHA, opacity);
      const columns = alphaAt(0.45, opacity);
      // Exact wherever the clamp at zero is not binding, which is the whole
      // range for the pane and most of it for the columns.
      if (columns > 0) expect(pane - columns, `at ${opacity}`).toBeCloseTo(designedGap, 10);
      else expect(pane, `at ${opacity}`).toBeGreaterThan(0.19);
    }
  });

  it('takes every material to solid at 1, and none of them past it', () => {
    for (const designed of WEIGHTS) {
      expect(alphaAt(designed, 1)).toBeCloseTo(1, 10);
    }
  });

  it('heads toward clear at the bottom of the range', () => {
    for (const designed of WEIGHTS) {
      expect(alphaAt(designed, MATERIAL_LIMITS.opacity.min)).toBeLessThan(designed);
    }
    // Extrapolated past the floor the line reaches zero, which is what makes
    // the floor a policy rather than an artefact of the maths.
    expect(alphaAt(0.6, 0)).toBeCloseTo(0, 10);
  });

  /*
   * The reason the transform is linear in the designed alpha at all. A control
   * that reordered the weights — or collapsed them onto one value — would erase
   * the hierarchy the four of them exist to express.
   */
  it('never reorders the weights, anywhere in the range', () => {
    for (let step = 0; step <= 100; step += 1) {
      const opacity =
        MATERIAL_LIMITS.opacity.min + (step / 100) * (1 - MATERIAL_LIMITS.opacity.min);
      const alphas = WEIGHTS.map((designed) => alphaAt(designed, opacity));

      for (let index = 1; index < alphas.length; index += 1) {
        expect(alphas[index]!, `at ${opacity}`).toBeGreaterThanOrEqual(alphas[index - 1]!);
      }
    }
  });

  it('moves in one direction only', () => {
    for (const designed of WEIGHTS) {
      let previous = -1;
      for (let step = 20; step <= 100; step += 1) {
        const alpha = alphaAt(designed, step / 100);
        expect(alpha, `${designed} at ${step}`).toBeGreaterThanOrEqual(previous);
        previous = alpha;
      }
    }
  });
});

describe('holding a stored value to the range', () => {
  it('keeps what is already valid', () => {
    expect(clampMaterials({ opacity: 0.7 })).toEqual({ opacity: 0.7 });
  });

  it('refuses to let anything put the panels below the floor', () => {
    expect(clampMaterials({ opacity: 0 }).opacity).toBe(MATERIAL_LIMITS.opacity.min);
    expect(clampMaterials({ opacity: -5 }).opacity).toBe(MATERIAL_LIMITS.opacity.min);
  });

  it('falls back to the shipped values for anything missing or nonsense', () => {
    expect(clampMaterials(undefined)).toEqual(DEFAULT_MATERIALS);
    expect(clampMaterials({})).toEqual(DEFAULT_MATERIALS);
    // Infinity is nonsense rather than "very large", so it falls back rather
    // than pinning to the top of the range.
    expect(clampMaterials({ opacity: Number.NaN })).toEqual(DEFAULT_MATERIALS);
    expect(clampMaterials({ opacity: 9 })).toEqual({ opacity: MATERIAL_LIMITS.opacity.max });
  });

  /*
   * A setting stored before the blur control was removed still loads. It was a
   * real value people had moved, and refusing to read the object it lives in
   * would reset the opacity they chose along with it.
   */
  it('ignores a value it no longer has a use for', () => {
    expect(clampMaterials({ opacity: 0.7, blur: 12 } as Partial<Materials>)).toEqual({
      opacity: 0.7,
    });
  });
});
