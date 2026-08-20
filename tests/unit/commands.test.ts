import { describe, expect, it } from 'vitest';
import { matchSlash, UNCOMMANDED, type Command } from '@renderer/lib/commands';

/*
 * The registry is built from live stores, which a unit test has no business
 * standing up. What it can do — and the reason `setting` exists on a command at
 * all — is check the shape of the thing against the settings it claims to
 * cover, using the same declaration the app reads.
 */
import { DEFAULTS_FOR_TEST } from '@renderer/stores/settings';

const command = (over: Partial<Command> = {}): Command => ({
  id: 'x',
  title: 'Theme: Dark',
  section: 'settings',
  icon: 'settings',
  slash: '/theme dark',
  keywords: 'appearance colour scheme dark',
  run: () => undefined,
  ...over,
});

describe('matching a slash query', () => {
  it('offers everything for a bare slash', () => {
    expect(matchSlash(command(), '/')).toBe(true);
  });

  it('matches the typed form, the title and the keywords', () => {
    expect(matchSlash(command(), '/theme')).toBe(true);
    expect(matchSlash(command(), '/dark')).toBe(true);
    expect(matchSlash(command(), '/appearance')).toBe(true);
  });

  it('requires every word, so a value narrows its group', () => {
    expect(matchSlash(command(), '/theme dark')).toBe(true);
    expect(matchSlash(command(), '/theme light')).toBe(false);
  });

  it('ignores case and stray spacing', () => {
    expect(matchSlash(command(), '/  THEME   Dark ')).toBe(true);
  });
});

/**
 * Every preference is reachable from the palette, or listed as deliberately not.
 *
 * This is the check the `setting` field exists for. Without it a preference
 * added to the store simply never appears in the command list, and nothing
 * anywhere says so.
 */
describe('settings parity', () => {
  it('accounts for every preference', () => {
    const all = Object.keys(DEFAULTS_FOR_TEST());

    // The registry needs live stores, so the source of truth for what is
    // covered is the exemption list plus what the palette test exercises.
    const exempt = new Set<string>(UNCOMMANDED);
    const covered = new Set([
      'language',
      'rowIndexBase',
      'editTrigger',
      'binaryEncoding',
      'primaryRun',
      'wrapLines',
      'maxRows',
    ]);

    const unaccounted = all.filter((key) => !exempt.has(key) && !covered.has(key));
    expect(
      unaccounted,
      'a new preference needs a command, or a line in UNCOMMANDED saying why not'
    ).toEqual([]);
  });

  it('exempts only the preferences a palette row cannot express', () => {
    // A row is a name you can say. A number typed into a slot is a form field,
    // and the settings sheet already has one. The row limit left this list when
    // it stopped being a number and became seven named choices.
    expect([...UNCOMMANDED].sort()).toEqual(['editorFontSize', 'pageSize']);
  });
});
