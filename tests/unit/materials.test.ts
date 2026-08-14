import { describe, expect, it } from 'vitest';
import {
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
  it('leaves every material exactly as designed at the midpoint', () => {
    for (const designed of WEIGHTS) {
      expect(alphaAt(designed, DESIGNED_OPACITY)).toBeCloseTo(designed, 10);
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
    expect(clampMaterials({ opacity: 0.7, blur: 1.5 })).toEqual({ opacity: 0.7, blur: 1.5 });
  });

  it('refuses to let anything put the panels below the floor', () => {
    expect(clampMaterials({ opacity: 0, blur: 1 }).opacity).toBe(MATERIAL_LIMITS.opacity.min);
    expect(clampMaterials({ opacity: -5, blur: 1 }).opacity).toBe(MATERIAL_LIMITS.opacity.min);
  });

  it('falls back to the shipped values for anything missing or nonsense', () => {
    expect(clampMaterials(undefined)).toEqual(DEFAULT_MATERIALS);
    expect(clampMaterials({})).toEqual(DEFAULT_MATERIALS);
    // Infinity is nonsense rather than "very large", so it falls back rather
    // than pinning to the top of the range.
    expect(clampMaterials({ opacity: Number.NaN, blur: Number.POSITIVE_INFINITY })).toEqual(
      DEFAULT_MATERIALS
    );
    expect(clampMaterials({ opacity: 9, blur: 900 })).toEqual({
      opacity: MATERIAL_LIMITS.opacity.max,
      blur: MATERIAL_LIMITS.blur.max,
    });
  });
});
