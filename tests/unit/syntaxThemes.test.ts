import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEME,
  SYNTAX_SCHEMES,
  SYNTAX_TOKENS,
  syntaxProperties,
  syntaxScheme,
} from '@shared/syntaxThemes';

/*
 * A palette fails quietly. A token missing from one appearance falls back to
 * whatever the built-in declared, which looks like a deliberate accent rather
 * than a hole — so what is checked here is completeness, not taste.
 */

describe('the scheme catalogue', () => {
  it('gives every scheme both appearances, or neither', () => {
    for (const scheme of SYNTAX_SCHEMES) {
      const halves = [scheme.light, scheme.dark].filter(Boolean).length;
      expect(halves, `${scheme.id} has one appearance and not the other`).not.toBe(1);
    }
  });

  it('colours every token in every palette', () => {
    for (const scheme of SYNTAX_SCHEMES) {
      for (const appearance of ['light', 'dark'] as const) {
        const palette = scheme[appearance];
        if (!palette) continue;
        for (const token of SYNTAX_TOKENS) {
          expect(palette[token], `${scheme.id}.${appearance}.${token}`).toMatch(
            /^#[0-9a-f]{6}$/i
          );
        }
      }
    }
  });

  it('leaves the built-in to the stylesheet', () => {
    // Pasting Shelf's own values here would be a second copy that stops
    // agreeing the first time either moves.
    expect(syntaxProperties(DEFAULT_SCHEME, 'light')).toBeUndefined();
    expect(syntaxProperties(DEFAULT_SCHEME, 'dark')).toBeUndefined();
  });

  it('falls back rather than throwing on an id it does not know', () => {
    // A stored setting outlives a build, and a scheme removed in an update must
    // not take the window with it.
    expect(syntaxScheme('a scheme from the future').id).toBe(DEFAULT_SCHEME);
  });

  it('offers the schemes people actually name', () => {
    const ids = SYNTAX_SCHEMES.map((scheme) => scheme.id);
    for (const id of ['vscode', 'nord', 'tokyoNight', 'gruvbox', 'catppuccin', 'oneDark']) {
      expect(ids).toContain(id);
    }
  });

  it('has no two schemes under one id', () => {
    const ids = SYNTAX_SCHEMES.map((scheme) => scheme.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
