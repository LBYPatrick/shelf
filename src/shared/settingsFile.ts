/**
 * Settings as a document.
 *
 * Two things are true at once: the interface is the good way to change a
 * setting, and a file is the good way to move a hundred of them to another
 * machine or into a repository. So there is one state and two views of it — the
 * form and the JSON — and this module is the boundary between them.
 *
 * It is pure on purpose. Reading and writing settings involves a store, a
 * composable, localStorage and the app database; validating a document that a
 * person typed involves none of those, and it is the part where a mistake is
 * silent. Everything here takes plain values and returns plain values, and it
 * is unit tested.
 *
 * Preferences live in two places in this app — appearance in the browser's own
 * storage because it has to be read before the window paints, everything else
 * in the app database — and a person exporting "my settings" means both. The
 * document joins them; the caller puts each half back where it came from.
 */

import { UNLIMITED } from './rowLimit';
import { isObject } from './json';

export const SETTINGS_DOCUMENT_KIND = 'shelf.settings';
export const SETTINGS_DOCUMENT_VERSION = 1;

/** The appearance half, flattened out of the theme store. */
export interface AppearanceState {
  readonly mode: string;
  readonly density: string;
  readonly accent: { readonly l: number; readonly c: number; readonly h: number };
  readonly opacity: number;
}

/** The preferences half, as the settings store holds it. */
export type PreferenceState = Record<string, unknown>;

export interface SettingsState {
  readonly appearance: AppearanceState;
  readonly preferences: PreferenceState;
}

export interface SettingsDocument {
  readonly kind: typeof SETTINGS_DOCUMENT_KIND;
  readonly version: number;
  readonly appearance: AppearanceState;
  readonly preferences: PreferenceState;
}

/**
 * What each key may hold.
 *
 * A hand-edited document is the reason this exists. Without it `"density":
 * "huge"` writes straight through to a data attribute nothing has a rule for,
 * and the window comes back with no spacing at all and no setting in the
 * interface that can be moved to undo it.
 */
const ENUMS: Readonly<Record<string, readonly string[]>> = {
  mode: ['system', 'light', 'dark'],
  density: ['compact', 'default', 'comfortable'],
  editTrigger: ['dblclick', 'click'],
  binaryEncoding: ['hex', 'base64'],
  primaryRun: ['all', 'current'],
  language: ['system', 'en-US', 'ja', 'zh-CN', 'ko', 'vi'],
};

/** Numbers are clamped rather than rejected: an out-of-range page size is a
 *  typo, and the nearest legal value is what was meant. */
const BOUNDS: Readonly<Record<string, { readonly min: number; readonly max: number }>> = {
  opacity: { min: 0.2, max: 1 },
  pageSize: { min: 10, max: 1000 },
  // The smallest the dropdown offers, up to the sentinel meaning no limit at
  // all. It used to floor at a thousand, which quietly overruled the default of
  // five hundred for anyone who edited their settings as JSON.
  maxRows: { min: 10, max: UNLIMITED },
  editorFontSize: { min: 10, max: 24 },
  rowIndexBase: { min: 0, max: 1 },
};

function toSettingsDocument(state: SettingsState): SettingsDocument {
  return {
    kind: SETTINGS_DOCUMENT_KIND,
    version: SETTINGS_DOCUMENT_VERSION,
    appearance: state.appearance,
    preferences: { ...state.preferences },
  };
}

export function serializeSettings(state: SettingsState): string {
  return `${JSON.stringify(toSettingsDocument(state), null, 2)}\n`;
}

export type ApplyResult =
  | { readonly ok: true; readonly state: SettingsState }
  | { readonly ok: false; readonly error: string };

function clamp(key: string, value: number): number {
  const bounds = BOUNDS[key];
  if (!bounds) return value;
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

/**
 * Keeps an incoming value only if it is the same *kind* of thing as the one it
 * replaces, and is a value that exists.
 *
 * Anything else is dropped rather than reported. A document written by a newer
 * version of the app will carry keys this one has never heard of, and refusing
 * the whole file over one of them would make settings the thing that stops you
 * moving between versions.
 */
function merge<T extends Record<string, unknown>>(current: T, incoming: unknown): T {
  if (!isObject(incoming)) return current;

  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    const existing = current[key];
    if (existing === undefined) continue;
    if (typeof value !== typeof existing) continue;

    const allowed = ENUMS[key];
    if (allowed) {
      if (typeof value === 'string' && allowed.includes(value)) next[key] = value;
      continue;
    }

    next[key] = typeof value === 'number' ? clamp(key, value) : value;
  }
  return next as T;
}

/** The accent is three numbers that only mean something together, so it is
 *  taken whole or not at all. */
function readAccent(current: AppearanceState['accent'], incoming: unknown) {
  if (!isObject(incoming)) return current;
  const { l, c, h } = incoming;
  if (typeof l !== 'number' || typeof c !== 'number' || typeof h !== 'number') return current;
  if (!Number.isFinite(l) || !Number.isFinite(c) || !Number.isFinite(h)) return current;
  return { l: Math.min(1, Math.max(0, l)), c: Math.max(0, c), h };
}

function applySettingsDocument(input: unknown, current: SettingsState): ApplyResult {
  if (!isObject(input)) return { ok: false, error: 'Expected a JSON object of settings.' };

  const appearance = isObject(input['appearance']) ? input['appearance'] : {};
  const preferences = isObject(input['preferences']) ? input['preferences'] : {};

  return {
    ok: true,
    state: {
      appearance: {
        ...merge(
          {
            mode: current.appearance.mode,
            density: current.appearance.density,
            opacity: current.appearance.opacity,
          },
          appearance
        ),
        accent: readAccent(current.appearance.accent, appearance['accent']),
      },
      preferences: merge(current.preferences, preferences),
    },
  };
}

export function parseSettings(json: string, current: SettingsState): ApplyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  return applySettingsDocument(parsed, current);
}
