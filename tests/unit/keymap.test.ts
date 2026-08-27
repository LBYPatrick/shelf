import { describe, expect, it } from 'vitest';
import {
  acceleratorFrom,
  keymapConflicts,
  keymapOverrides,
  normalizeAccelerator,
  parseKeymap,
  resolveKeymap,
  serializeKeymap,
  type KeyBinding,
  type Keystroke,
} from '@shared/keymap';

const DEFAULTS: KeyBinding[] = [
  { id: 'palette.open', keys: ['mod+k', 'mod+p'] },
  { id: 'tab.new', keys: ['mod+t'] },
  { id: 'query.run', keys: ['mod+enter'] },
];

const stroke = (over: Partial<Keystroke>): Keystroke => ({
  key: 'k',
  code: 'KeyK',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

describe('spelling a chord', () => {
  it('puts the modifiers in one order whatever order they arrive in', () => {
    expect(normalizeAccelerator('shift+mod+k')).toBe('mod+shift+k');
    expect(normalizeAccelerator('MOD+Shift+K')).toBe('mod+shift+k');
  });

  it('takes the words people write by hand', () => {
    expect(normalizeAccelerator('cmd+k')).toBe('mod+k');
    expect(normalizeAccelerator('Command+Shift+T')).toBe('mod+shift+t');
  });

  it('refuses a modifier on its own', () => {
    // Half a chord is not a chord, and storing one would be a binding that can
    // never fire.
    expect(normalizeAccelerator('mod')).toBeUndefined();
    expect(normalizeAccelerator('')).toBeUndefined();
  });
});

describe('recording a keystroke', () => {
  it('reads the primary modifier as `mod` on either platform', () => {
    expect(acceleratorFrom(stroke({ metaKey: true }), true)).toBe('mod+k');
    expect(acceleratorFrom(stroke({ ctrlKey: true }), false)).toBe('mod+k');
  });

  it('keeps Control as itself on a Mac', () => {
    expect(acceleratorFrom(stroke({ ctrlKey: true }), true)).toBe('ctrl+k');
  });

  it('takes the letter from the key, not from what the layout produced', () => {
    /*
     * ⌥⇧K arrives as `Ë` on a US layout. Storing that would produce a binding
     * that matches nothing, on a keyboard where the same physical press
     * produces a different character.
     */
    const alt = stroke({ key: 'Ë', code: 'KeyK', altKey: true, shiftKey: true, metaKey: true });
    expect(acceleratorFrom(alt, true)).toBe('mod+alt+shift+k');
  });

  it('is nothing while only a modifier is held', () => {
    expect(
      acceleratorFrom(stroke({ key: 'Meta', code: 'MetaLeft', metaKey: true }), true)
    ).toBeUndefined();
  });
});

describe('laying overrides over the defaults', () => {
  it('replaces a binding whole', () => {
    const resolved = resolveKeymap(DEFAULTS, { 'tab.new': ['mod+shift+n'] });
    expect(resolved.find((b) => b.id === 'tab.new')?.keys).toEqual(['mod+shift+n']);
  });

  it('drops an override for an action that no longer exists', () => {
    // A keymap outlives the build it was written in.
    const resolved = resolveKeymap(DEFAULTS, { 'tab.teleport': ['mod+9'] });
    expect(resolved.map((b) => b.id)).toEqual(DEFAULTS.map((b) => b.id));
  });

  it('reports only what differs', () => {
    const resolved = resolveKeymap(DEFAULTS, { 'tab.new': ['mod+shift+n'] });
    expect(keymapOverrides(DEFAULTS, resolved)).toEqual({ 'tab.new': ['mod+shift+n'] });
  });
});

describe('conflicts', () => {
  it('names a chord two actions claim', () => {
    const bindings = resolveKeymap(DEFAULTS, { 'tab.new': ['mod+k'] });
    expect(keymapConflicts(bindings)).toEqual([
      { accelerator: 'mod+k', ids: ['palette.open', 'tab.new'] },
    ]);
  });

  it('sees through two spellings of one chord', () => {
    // The whole reason a chord has one spelling: `Mod+Shift+K` and
    // `shift+mod+k` are the same keystroke, and a check that compares the
    // strings says they are not.
    const clash: KeyBinding[] = [
      { id: 'a', keys: ['Mod+Shift+K'] },
      { id: 'b', keys: ['shift+mod+k'] },
    ];
    expect(keymapConflicts(clash)).toHaveLength(1);
  });

  it('says nothing about the defaults', () => {
    expect(keymapConflicts(DEFAULTS)).toEqual([]);
  });
});

describe('the document', () => {
  it('writes every binding, not only the changed ones', () => {
    // A file holding three lines because three things changed is unusable for
    // the thing a document is for.
    const text = serializeKeymap(DEFAULTS);
    expect(Object.keys(JSON.parse(text).bindings)).toEqual(DEFAULTS.map((b) => b.id));
  });

  it('round-trips through a parse unchanged', () => {
    const resolved = resolveKeymap(DEFAULTS, { 'tab.new': ['mod+shift+n'] });
    const result = parseKeymap(serializeKeymap(resolved), DEFAULTS);
    expect(result).toEqual({ ok: true, overrides: { 'tab.new': ['mod+shift+n'] } });
  });

  it('takes a bare object of bindings too', () => {
    expect(parseKeymap('{"tab.new": ["mod+shift+n"]}', DEFAULTS)).toEqual({
      ok: true,
      overrides: { 'tab.new': ['mod+shift+n'] },
    });
  });

  it('refuses a chord it cannot read, by name', () => {
    const result = parseKeymap('{"tab.new": ["mod+"]}', DEFAULTS);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('tab.new');
  });

  it('drops an id it has never heard of rather than refusing the file', () => {
    // A document written by a newer build must not be the thing that stops you
    // moving between versions.
    expect(parseKeymap('{"tab.teleport": ["mod+9"]}', DEFAULTS)).toEqual({
      ok: true,
      overrides: {},
    });
  });

  it('says what is wrong with something that is not a document at all', () => {
    expect(parseKeymap('[]', DEFAULTS).ok).toBe(false);
    expect(parseKeymap('{', DEFAULTS).ok).toBe(false);
  });
});
