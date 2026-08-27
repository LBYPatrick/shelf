/**
 * Keybindings as data.
 *
 * One map, compiled into whichever consumer needs it — global hotkeys, the
 * editor keymap, the grid. `mod` resolves to Command on macOS and Control
 * everywhere else, so a binding is written once rather than per platform.
 *
 * The list below is the *default*. What the app actually runs on is
 * `bindings`, which is that list with the reader's changes laid over it, and
 * it is a `computed` so a chord changed in Settings redraws every hint beside
 * every action rather than only taking effect on the keyboard. The arithmetic
 * — spelling a chord one way, reading one out of a keystroke, finding two
 * actions claiming the same one — is in `@shared/keymap`, where it is pure and
 * unit tested.
 */
import { computed, ref, watch } from 'vue';
import { normalizeAccelerator, resolveKeymap, type KeymapOverrides } from '@shared/keymap';
import { saveSetting } from './settings';

export interface Binding {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  /** Accelerators in `mod+shift+key` form; the first is the one displayed. */
  readonly keys: readonly string[];
  /**
   * Handled before the focused widget rather than after it.
   *
   * The default is after, which is right for anything an editor or a grid could
   * reasonably claim: ⌘F inside the query editor should open *its* find widget,
   * not jump to the grid's filter. It is wrong for the window's own chrome. ⌘K
   * is a chord prefix in Monaco's keymap — the start of ⌘K ⌘C and a dozen
   * others — so Monaco stopped the event dead and the palette never opened
   * while the editor had focus. Nothing a widget does should be able to take
   * away the way out of it.
   */
  readonly global?: boolean;
}

export const DEFAULT_BINDINGS: readonly Binding[] = [
  {
    id: 'palette.open',
    label: 'Command palette',
    group: 'General',
    keys: ['mod+k', 'mod+p'],
    global: true,
  },
  { id: 'settings.open', label: 'Settings', group: 'General', keys: ['mod+,'], global: true },
  { id: 'schema.refresh', label: 'Refresh schema', group: 'General', keys: ['f5'] },
  {
    id: 'sidebar.toggle',
    label: 'Toggle sidebar',
    group: 'General',
    keys: ['mod+b'],
    global: true,
  },

  { id: 'tab.new', label: 'New query tab', group: 'Tabs', keys: ['mod+t'], global: true },
  {
    id: 'assistant.open',
    label: 'New assistant chat',
    group: 'Tabs',
    keys: ['mod+shift+a'],
    global: true,
  },
  { id: 'tab.close', label: 'Close tab', group: 'Tabs', keys: ['mod+w'], global: true },
  {
    id: 'tab.reopen',
    label: 'Reopen last closed tab',
    group: 'Tabs',
    keys: ['mod+shift+t'],
    global: true,
  },
  { id: 'tab.next', label: 'Next tab', group: 'Tabs', keys: ['ctrl+tab'], global: true },
  {
    id: 'tab.previous',
    label: 'Previous tab',
    group: 'Tabs',
    keys: ['ctrl+shift+tab'],
    global: true,
  },

  { id: 'query.run', label: 'Run', group: 'Query', keys: ['mod+enter'] },
  {
    id: 'query.runCurrent',
    label: 'Run current statement',
    group: 'Query',
    keys: ['mod+shift+enter'],
  },

  { id: 'data.filter', label: 'Focus filter', group: 'Data', keys: ['mod+f'] },
  { id: 'data.apply', label: 'Apply pending changes', group: 'Data', keys: ['mod+s'] },
];

/**
 * Only what differs from the defaults is stored.
 *
 * A keymap outlives the build it was written in, so recording every chord would
 * mean a reader who changed one shortcut in an old version keeps the old
 * default for every shortcut that has moved since.
 */
const overrides = ref<KeymapOverrides>({});

export const bindings = computed<readonly Binding[]>(() =>
  resolveKeymap(DEFAULT_BINDINGS, overrides.value)
);

const SETTING = 'keymap';

/**
 * Read once at startup, and written on every change after that.
 *
 * Explicit rather than done on import, because the storybook and the tests
 * mount this module without a host to ask.
 */
export async function loadKeymap(): Promise<void> {
  try {
    overrides.value = await window.shelf.db.getSetting<KeymapOverrides>(SETTING, {});
  } catch {
    // A keymap that cannot be read is the defaults, not a broken window.
  }

  watch(overrides, (next) => void saveSetting(SETTING, next), { deep: true });
}

/** Replaces one action's chords whole; an empty list unbinds it. */
export function setBinding(id: string, keys: readonly string[]): void {
  const normalized = keys
    .map((key) => normalizeAccelerator(key))
    .filter((key): key is string => key !== undefined);

  const original = DEFAULT_BINDINGS.find((binding) => binding.id === id)?.keys ?? [];
  const next = { ...overrides.value };

  if (
    original.length === normalized.length &&
    original.every((key, index) => key === normalized[index])
  ) {
    delete next[id];
  } else {
    next[id] = normalized;
  }

  overrides.value = next;
}

export function currentOverrides(): KeymapOverrides {
  return overrides.value;
}

export function applyOverrides(next: KeymapOverrides): void {
  overrides.value = { ...next };
}

export function resetKeymap(): void {
  overrides.value = {};
}

/**
 * One answer, shared.
 *
 * The recorder and the renderer of a chord have to agree about which key `mod`
 * is, or a shortcut is recorded on one platform's rules and drawn on another's
 * — which is a chord that reads back as a different chord from the one that was
 * pressed. The platform store answers this too, and asynchronously; this is the
 * synchronous fact, and both sides read it.
 */
export const isMac = navigator.platform.toLowerCase().includes('mac');

/** Renders an accelerator the way this platform writes it. */
export function displayKeys(accelerator: string): string {
  return accelerator
    .split('+')
    .map((part) => {
      switch (part) {
        case 'mod':
          return isMac ? '⌘' : 'Ctrl';
        case 'shift':
          return isMac ? '⇧' : 'Shift';
        case 'alt':
          return isMac ? '⌥' : 'Alt';
        case 'ctrl':
          return isMac ? '⌃' : 'Ctrl';
        case 'enter':
          return '↩';
        case 'tab':
          return '⇥';
        default:
          return part.length === 1 ? part.toUpperCase() : part.toUpperCase();
      }
    })
    .join(isMac ? '' : '+');
}

/** True when the event matches the accelerator. */
export function matches(event: KeyboardEvent, accelerator: string): boolean {
  const parts = accelerator.split('+');
  const key = parts[parts.length - 1] ?? '';

  const wantMod = parts.includes('mod');
  const wantShift = parts.includes('shift');
  const wantAlt = parts.includes('alt');
  const wantCtrl = parts.includes('ctrl');

  const modPressed = isMac ? event.metaKey : event.ctrlKey;
  // `ctrl` means the physical Control key on every platform, which is why it is
  // spelled differently from `mod`.
  const ctrlPressed = event.ctrlKey;

  if (wantMod !== modPressed) return false;
  if (wantShift !== event.shiftKey) return false;
  if (wantAlt !== event.altKey) return false;
  if (wantCtrl && !ctrlPressed) return false;
  if (!wantMod && !wantCtrl && ctrlPressed) return false;

  return event.key.toLowerCase() === key || event.code.toLowerCase() === `key${key}`;
}

export function bindingFor(id: string): Binding | undefined {
  return bindings.value.find((binding) => binding.id === id);
}

/** The accelerator to show next to an action, already rendered. */
export function shortcutLabel(id: string): string {
  const first = bindingFor(id)?.keys[0];
  return first ? displayKeys(first) : '';
}
