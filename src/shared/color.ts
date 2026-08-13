/**
 * Colour conversion and contrast measurement.
 *
 * The theme is authored in OKLCH because its lightness axis is perceptually
 * uniform, but accessibility is defined in sRGB, so we need to be able to cross
 * between them — both to verify contrast in tests and to hand concrete colours
 * to canvas and SVG code that cannot resolve custom properties.
 */

export interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * OKLCH to linear sRGB, via OKLab. Constants are from Björn Ottosson's
 * definition of the Oklab colour space.
 */
function oklchToLinearSrgb({ l, c, h }: Oklch): Rgb {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const lCone = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mCone = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sCone = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return {
    r: 4.0767416621 * lCone - 3.3077115913 * mCone + 0.2309699292 * sCone,
    g: -1.2684380046 * lCone + 2.6097574011 * mCone - 0.3413193965 * sCone,
    b: -0.0041960863 * lCone - 0.7034186147 * mCone + 1.707614701 * sCone,
  };
}

/** The sRGB transfer function. */
function encodeGamma(channel: number): number {
  const v = clamp01(channel);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** Its inverse, which WCAG luminance is defined against. */
function decodeGamma(channel: number): number {
  const v = clamp01(channel);
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** OKLCH to gamma-encoded sRGB, each channel 0-1. Out-of-gamut values are clipped. */
export function oklchToSrgb(color: Oklch): Rgb {
  const linear = oklchToLinearSrgb(color);
  return {
    r: encodeGamma(linear.r),
    g: encodeGamma(linear.g),
    b: encodeGamma(linear.b),
  };
}

export function toHex(color: Oklch): string {
  const { r, g, b } = oklchToSrgb(color);
  const channel = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(color: Oklch): number {
  const { r, g, b } = oklchToSrgb(color);
  return 0.2126 * decodeGamma(r) + 0.7152 * decodeGamma(g) + 0.0722 * decodeGamma(b);
}

/**
 * WCAG 2.1 contrast ratio, 1 (identical) to 21 (black on white).
 * Body text needs 4.5, large text and UI components need 3.
 */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
