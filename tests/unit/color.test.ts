import { describe, expect, it } from 'vitest';
import { contrastRatio, oklchToSrgb, relativeLuminance, toHex } from '@shared/color';

describe('oklch to srgb', () => {
  it('maps the achromatic extremes to black and white', () => {
    expect(toHex({ l: 0, c: 0, h: 0 })).toBe('#000000');
    expect(toHex({ l: 1, c: 0, h: 0 })).toBe('#ffffff');
  });

  it('clips out-of-gamut colours into range rather than producing NaN', () => {
    // Chroma far beyond what sRGB can express at this lightness.
    const { r, g, b } = oklchToSrgb({ l: 0.6, c: 0.37, h: 150 });
    for (const channel of [r, g, b]) {
      expect(Number.isFinite(channel)).toBe(true);
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
    }
  });

  it('places a mid-grey well below the sRGB midpoint', () => {
    // OKLCH lightness is perceptual, not linear in sRGB: L=0.5 is the colour
    // that *looks* half as bright, which sits near sRGB 99, not 128.
    const value = parseInt(toHex({ l: 0.5, c: 0, h: 0 }).slice(1, 3), 16);
    expect(value).toBeGreaterThan(90);
    expect(value).toBeLessThan(110);
  });
});

describe('contrast', () => {
  it('reports the WCAG maximum for black on white', () => {
    expect(contrastRatio({ l: 0, c: 0, h: 0 }, { l: 1, c: 0, h: 0 })).toBeCloseTo(21, 1);
  });

  it('reports 1 for a colour against itself', () => {
    expect(contrastRatio({ l: 0.6, c: 0.2, h: 250 }, { l: 0.6, c: 0.2, h: 250 })).toBeCloseTo(
      1,
      5
    );
  });

  it('is symmetric', () => {
    const a = { l: 0.3, c: 0.1, h: 20 };
    const b = { l: 0.9, c: 0.05, h: 200 };
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });

  it('increases monotonically as lightness separates', () => {
    const base = { l: 0.1, c: 0, h: 0 };
    const near = contrastRatio(base, { l: 0.4, c: 0, h: 0 });
    const far = contrastRatio(base, { l: 0.8, c: 0, h: 0 });
    expect(far).toBeGreaterThan(near);
  });

  it('rises with luminance', () => {
    expect(relativeLuminance({ l: 0.9, c: 0, h: 0 })).toBeGreaterThan(
      relativeLuminance({ l: 0.2, c: 0, h: 0 })
    );
  });
});
