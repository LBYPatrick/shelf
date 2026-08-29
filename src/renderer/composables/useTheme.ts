import { defineStore } from 'pinia';
import { computed, ref, watchEffect } from 'vue';
import {
  ACCENT_PRESETS,
  accentId,
  readAccent,
  DEFAULT_ACCENT,
  DEFAULT_MATERIALS,
  DEFAULT_SYNTAX,
  applyTheme,
  clampMaterials,
  clampSyntax,
  resolveAppearance,
  type Density,
  type Materials,
  type Oklch,
  type Syntax,
  type ThemeMode,
} from '../styles/theme';

const STORAGE_KEY = 'shelf.appearance';

interface StoredAppearance {
  mode: ThemeMode;
  /** The preset's id. Older builds wrote the triple; `readAccent` takes both. */
  accent: string;
  density: Density;
  materials: Materials;
  syntax: Syntax;
}

function readStored(): Partial<StoredAppearance> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<StoredAppearance>) : {};
  } catch {
    // A corrupt or unavailable store is not worth failing startup over.
    return {};
  }
}

export const useTheme = defineStore('theme', () => {
  const stored = readStored();

  const mode = ref<ThemeMode>(stored.mode ?? 'system');
  const accent = ref<Oklch>(readAccent(stored.accent) ?? DEFAULT_ACCENT);
  const density = ref<Density>(stored.density ?? 'default');
  // Clamped on the way in as well as on the way out: a hand-edited or
  // half-written store should not be able to put the window into a state with
  // no way back to it through the interface.
  const materials = ref<Materials>(clampMaterials(stored.materials));
  // Clamped on the way in for the same reason: a scheme removed in an update
  // must not take the editor's colours with it.
  const syntax = ref<Syntax>(clampSyntax(stored.syntax));

  // The OS preference is watched live, so a system-level switch to dark mode
  // takes effect without a restart.
  const systemPrefersDark = ref(
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
  );

  if (typeof matchMedia === 'function') {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
      systemPrefersDark.value = event.matches;
    });
  }

  const appearance = computed(() => resolveAppearance(mode.value, systemPrefersDark.value));

  const presets = ACCENT_PRESETS;

  const activePreset = computed(() =>
    presets.find((preset) => preset.id === accentId(accent.value))
  );

  watchEffect(() => {
    applyTheme(document.documentElement, {
      seed: accent.value,
      appearance: appearance.value,
      density: density.value,
      materials: materials.value,
      syntax: syntax.value,
    });

    // `mode`, not the resolved appearance: handing the OS `system` lets it keep
    // following itself, which is what the setting says.
    window.shelf.window.setAppearance(mode.value);

    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          mode: mode.value,
          accent: accentId(accent.value) ?? ACCENT_PRESETS[0]!.id,
          density: density.value,
          materials: materials.value,
          syntax: syntax.value,
        })
      );
    } catch {
      // Persisting appearance is a convenience, never a hard requirement.
    }
  });

  /** Puts the glass back the way it ships, without touching the accent or theme. */
  function resetMaterials(): void {
    materials.value = { ...DEFAULT_MATERIALS };
  }

  /**
   * Every appearance setting back to what it ships as.
   *
   * Here rather than in the sheet that offers it, because the store is the only
   * thing that knows what "every appearance setting" is. Spelled out in the
   * sheet, it would be a list to keep in step with this file, and the way it
   * would fall behind is the way `resetMaterials` was already a partial reset
   * that read like a whole one.
   */
  function reset(): void {
    mode.value = 'system';
    accent.value = DEFAULT_ACCENT;
    density.value = 'default';
    materials.value = { ...DEFAULT_MATERIALS };
    syntax.value = { ...DEFAULT_SYNTAX };
  }

  return {
    mode,
    accent,
    density,
    materials,
    syntax,
    appearance,
    presets,
    activePreset,
    resetMaterials,
    reset,
  };
});
