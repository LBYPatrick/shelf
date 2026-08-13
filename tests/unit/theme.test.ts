import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@shared/color';
import {
  ACCENT_PRESETS,
  buildPalette,
  oklch,
  resolveAppearance,
  themeVariables,
  type Appearance,
} from '@renderer/styles/theme';

const APPEARANCES: readonly Appearance[] = ['light', 'dark'];

/**
 * The promise the accent picker makes is that *any* accent stays readable. A
 * palette that only works for the default blue is a bug, so every preset is
 * measured in both appearances.
 */
describe('accent palette contrast', () => {
  for (const preset of ACCENT_PRESETS) {
    for (const appearance of APPEARANCES) {
      describe(`${preset.name} / ${appearance}`, () => {
        const palette = buildPalette(preset.seed, appearance);

        it('clears 4.5:1 for body text on every base surface', () => {
          for (const surface of [palette.base100, palette.base200, palette.base300]) {
            expect(contrastRatio(palette.baseContent, surface)).toBeGreaterThanOrEqual(4.5);
          }
        });

        it('clears 4.5:1 for text on the accent', () => {
          expect(contrastRatio(palette.primaryContent, palette.primary)).toBeGreaterThanOrEqual(
            4.5
          );
        });

        it('clears 3:1 for the accent itself against the page, so accented controls are visible', () => {
          expect(contrastRatio(palette.primary, palette.base100)).toBeGreaterThanOrEqual(3);
        });

        it('keeps the subtle accent fill distinguishable from the page', () => {
          expect(contrastRatio(palette.subtle, palette.base100)).toBeGreaterThan(1.05);
        });

        it('keeps body text readable on the subtle accent fill', () => {
          expect(contrastRatio(palette.baseContent, palette.subtle)).toBeGreaterThanOrEqual(
            4.5
          );
        });
      });
    }
  }
});

describe('neutral tinting', () => {
  it('carries the accent hue into the surfaces', () => {
    const green = buildPalette(ACCENT_PRESETS.find((p) => p.id === 'green')!.seed, 'light');
    const red = buildPalette(ACCENT_PRESETS.find((p) => p.id === 'red')!.seed, 'light');
    expect(green.base100.h).not.toBe(red.base100.h);
  });

  it('keeps that tint faint enough to still read as neutral', () => {
    for (const preset of ACCENT_PRESETS) {
      for (const appearance of APPEARANCES) {
        const palette = buildPalette(preset.seed, appearance);
        expect(palette.base100.c).toBeLessThan(0.02);
        expect(palette.base200.c).toBeLessThan(0.02);
      }
    }
  });
});

describe('serialisation', () => {
  it('emits valid oklch(), clamping out-of-range input', () => {
    expect(oklch({ l: 0.6, c: 0.21, h: 250 })).toBe('oklch(60.00% 0.2100 250.0)');
    expect(oklch({ l: 1.4, c: -1, h: 400 })).toBe('oklch(100.00% 0.0000 40.0)');
  });

  it('normalises negative hues', () => {
    expect(oklch({ l: 0.5, c: 0.1, h: -30 })).toContain('330.0');
  });

  it('produces every custom property the stylesheet relies on', () => {
    const vars = themeVariables(ACCENT_PRESETS[0]!.seed, 'dark');
    for (const key of [
      '--color-base-100',
      '--color-base-200',
      '--color-base-300',
      '--color-base-content',
      '--color-primary',
      '--color-primary-content',
      '--accent-hover',
      '--accent-press',
      '--accent-subtle',
      '--accent-hue',
    ]) {
      expect(vars[key], key).toBeDefined();
    }
  });
});

describe('appearance resolution', () => {
  it('follows the system only in system mode', () => {
    expect(resolveAppearance('system', true)).toBe('dark');
    expect(resolveAppearance('system', false)).toBe('light');
    expect(resolveAppearance('light', true)).toBe('light');
    expect(resolveAppearance('dark', false)).toBe('dark');
  });
});
