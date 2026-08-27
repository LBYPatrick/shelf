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
  it('colours every token in both appearances of every scheme', () => {
    for (const scheme of SYNTAX_SCHEMES) {
      for (const appearance of ['light', 'dark'] as const) {
        for (const token of SYNTAX_TOKENS) {
          expect(scheme[appearance][token], `${scheme.id}.${appearance}.${token}`).toMatch(
            /^#[0-9a-f]{6}$/i
          );
        }
      }
    }
  });

  it('defaults to a scheme with a name, not to the absence of one', () => {
    /*
     * There was a "Shelf" entry that wrote nothing and let the stylesheet
     * answer — the one row in the list whose name told the reader nothing
     * about what they were choosing.
     */
    expect(DEFAULT_SCHEME).toBe('monokaiPro');
    expect(syntaxScheme(DEFAULT_SCHEME).name).toBe('Monokai Pro');
    expect(SYNTAX_SCHEMES.map((scheme) => scheme.id)).not.toContain('shelf');
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

  it('answers for a scheme in both appearances', () => {
    // The properties are set unconditionally now, so a hole here would write
    // `undefined` onto the root and take the token with it.
    for (const appearance of ['light', 'dark'] as const) {
      for (const token of SYNTAX_TOKENS) {
        expect(syntaxProperties(DEFAULT_SCHEME, appearance)[token]).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('has no two schemes under one id', () => {
    const ids = SYNTAX_SCHEMES.map((scheme) => scheme.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
