/**
 * Keybindings as data a person can edit.
 *
 * The defaults live in the renderer, because they carry the words shown beside
 * them. What lives here is everything about a keymap that is arithmetic rather
 * than interface: reading an accelerator out of a keystroke, deciding whether
 * two actions are fighting over one, and turning a set of overrides into a
 * document and back.
 *
 * Pure on purpose, and unit tested, because every failure in it is quiet. An
 * accelerator recorded as `mod+Shift+K` and stored beside one written
 * `mod+shift+k` is two spellings of one chord, and the conflict check would say
 * they are different while the matcher says one of them never fires.
 */

export interface KeyBinding {
  readonly id: string;
  readonly keys: readonly string[];
}

export const KEYMAP_DOCUMENT_KIND = 'shelf.keymap';
export const KEYMAP_DOCUMENT_VERSION = 1;

/** Written in this order whatever order they were pressed in. */
const MODIFIER_ORDER = ['mod', 'ctrl', 'alt', 'shift'] as const;

const MODIFIERS = new Set<string>(MODIFIER_ORDER);

/**
 * The name a key is stored under.
 *
 * `event.key` is what the layout produced, which for a chord with Shift or
 * Option in it is a different character from the one printed on the key — ⌥⇧K
 * arrives as `Ë` on a US layout. `event.code` is the key itself, so a letter or
 * a digit is taken from there and everything else from `key`, lowercased.
 */
export function keyName(key: string, code: string): string | undefined {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!.toLowerCase();

  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (digit) return digit[1]!;

  const named = key.toLowerCase();
  if (named === ' ') return 'space';
  if (named.length === 0) return undefined;
  if (MODIFIERS.has(named) || ['control', 'meta', 'alt', 'shift', 'dead'].includes(named)) {
    return undefined;
  }
  return named;
}

/** One spelling per chord: modifiers in a fixed order, everything lowercase. */
export function normalizeAccelerator(accelerator: string): string | undefined {
  const parts = accelerator
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return undefined;

  const key = parts[parts.length - 1]!;
  if (MODIFIERS.has(key)) return undefined;

  const held = new Set(parts.slice(0, -1).filter((part) => MODIFIERS.has(part)));
  // `command` and `cmd` are what people type when they write one out by hand.
  if (parts.slice(0, -1).some((part) => ['cmd', 'command', 'meta', 'super'].includes(part))) {
    held.add('mod');
  }

  return [...MODIFIER_ORDER.filter((modifier) => held.has(modifier)), key].join('+');
}

export interface Keystroke {
  readonly key: string;
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * The accelerator a keystroke would be stored as, or nothing if it is not one
 * yet — a modifier held on its own is a chord still being typed.
 *
 * `mod` is the platform's own primary modifier, so recording ⌘K on a Mac and
 * Ctrl+K on Windows produces the same binding rather than one that only works
 * on the machine it was recorded on. Control on a Mac is a modifier in its own
 * right and keeps its own name.
 */
export function acceleratorFrom(event: Keystroke, isMac: boolean): string | undefined {
  const name = keyName(event.key, event.code);
  if (!name) return undefined;

  const parts: string[] = [];
  if (isMac ? event.metaKey : event.ctrlKey) parts.push('mod');
  if (event.ctrlKey && (isMac || event.metaKey)) parts.push('ctrl');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  parts.push(name);

  return normalizeAccelerator(parts.join('+'));
}

export type KeymapOverrides = Readonly<Record<string, readonly string[]>>;

/**
 * The defaults with the reader's changes laid over them.
 *
 * An override for an id that no longer exists is dropped rather than added: a
 * keymap outlives the build it was written in, and an action removed in an
 * update must not come back as a binding to nothing.
 */
export function resolveKeymap<T extends KeyBinding>(
  defaults: readonly T[],
  overrides: KeymapOverrides
): T[] {
  return defaults.map((binding) => {
    const override = overrides[binding.id];
    if (!override) return binding;

    const keys = override
      .map((key) => normalizeAccelerator(key))
      .filter((key): key is string => key !== undefined);

    return { ...binding, keys };
  });
}

export interface Conflict {
  readonly accelerator: string;
  readonly ids: readonly string[];
}

/**
 * Chords claimed by more than one action.
 *
 * Not an error — the hotkey layer resolves it by taking the first, and there
 * are legitimate pairs, an editor binding and a grid binding that are never
 * live at once. It is reported so the reader can see what they have done,
 * beside the thing they did it to.
 */
export function keymapConflicts(bindings: readonly KeyBinding[]): Conflict[] {
  const claims = new Map<string, string[]>();

  for (const binding of bindings) {
    for (const key of binding.keys) {
      const normalized = normalizeAccelerator(key);
      if (!normalized) continue;
      const ids = claims.get(normalized) ?? [];
      if (!ids.includes(binding.id)) ids.push(binding.id);
      claims.set(normalized, ids);
    }
  }

  return [...claims]
    .filter(([, ids]) => ids.length > 1)
    .map(([accelerator, ids]) => ({ accelerator, ids }));
}

/** Only what differs from the defaults, so the document stays about the changes. */
export function keymapOverrides(
  defaults: readonly KeyBinding[],
  bindings: readonly KeyBinding[]
): Record<string, string[]> {
  const byId = new Map(defaults.map((binding) => [binding.id, binding.keys]));
  const changed: Record<string, string[]> = {};

  for (const binding of bindings) {
    const original = byId.get(binding.id);
    if (!original) continue;
    if (
      original.length === binding.keys.length &&
      original.every((k, i) => k === binding.keys[i])
    ) {
      continue;
    }
    changed[binding.id] = [...binding.keys];
  }
  return changed;
}

export interface KeymapDocument {
  readonly kind: typeof KEYMAP_DOCUMENT_KIND;
  readonly version: number;
  readonly bindings: Record<string, string[]>;
}

/**
 * Every binding, not only the changed ones.
 *
 * The document is the other way of editing the keymap, and a file holding three
 * lines because three things were changed is unusable for the thing a document
 * is *for* — seeing what the chords are and rearranging them. What is *stored*
 * is still only the difference; see `keymapOverrides`.
 */
export function serializeKeymap(bindings: readonly KeyBinding[]): string {
  const document: KeymapDocument = {
    kind: KEYMAP_DOCUMENT_KIND,
    version: KEYMAP_DOCUMENT_VERSION,
    bindings: Object.fromEntries(bindings.map((binding) => [binding.id, [...binding.keys]])),
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

export type KeymapResult =
  | { readonly ok: true; readonly overrides: Record<string, string[]> }
  | { readonly ok: false; readonly error: string };

/**
 * A hand-written document, read against the defaults.
 *
 * An unknown id is dropped and an unreadable accelerator is refused by name,
 * because those are the two mistakes a person makes here and the difference
 * matters: a typo in a chord is worth stopping for, while an id from a newer
 * build is not something the reader can act on.
 */
export function parseKeymap(json: string, defaults: readonly KeyBinding[]): KeymapResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'Expected a JSON object of bindings.' };
  }

  const source = (parsed as { bindings?: unknown }).bindings ?? parsed;
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    return { ok: false, error: 'Expected "bindings" to be an object.' };
  }

  const known = new Map(defaults.map((binding) => [binding.id, binding.keys]));
  const overrides: Record<string, string[]> = {};

  for (const [id, value] of Object.entries(source as Record<string, unknown>)) {
    const original = known.get(id);
    if (!original) continue;

    const raw = Array.isArray(value) ? value : [value];
    const keys: string[] = [];
    for (const entry of raw) {
      if (typeof entry !== 'string') {
        return { ok: false, error: `${id}: a binding is a list of accelerators.` };
      }
      const normalized = normalizeAccelerator(entry);
      if (!normalized) return { ok: false, error: `${id}: "${entry}" is not a shortcut.` };
      keys.push(normalized);
    }

    if (original.length === keys.length && original.every((key, i) => key === keys[i]))
      continue;
    overrides[id] = keys;
  }

  return { ok: true, overrides };
}
