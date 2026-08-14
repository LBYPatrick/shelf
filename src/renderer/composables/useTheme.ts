import { defineStore } from 'pinia';
import { computed, ref, watchEffect } from 'vue';
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT,
  DEFAULT_MATERIALS,
  applyTheme,
  clampMaterials,
  resolveAppearance,
  type Density,
  type Materials,
  type Oklch,
  type ThemeMode,
} from '../styles/theme';

const STORAGE_KEY = 'shelf.appearance';

interface StoredAppearance {
  mode: ThemeMode;
  accent: Oklch;
  density: Density;
  materials: Materials;
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
  const accent = ref<Oklch>(stored.accent ?? DEFAULT_ACCENT);
  const density = ref<Density>(stored.density ?? 'default');
  // Clamped on the way in as well as on the way out: a hand-edited or
  // half-written store should not be able to put the window into a state with
  // no way back to it through the interface.
  const materials = ref<Materials>(clampMaterials(stored.materials));

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
    presets.find(
      (preset) =>
        preset.seed.h === accent.value.h &&
        preset.seed.c === accent.value.c &&
        preset.seed.l === accent.value.l
    )
  );

  watchEffect(() => {
    applyTheme(document.documentElement, {
      seed: accent.value,
      appearance: appearance.value,
      density: density.value,
      materials: materials.value,
    });

    // `mode`, not the resolved appearance: handing the OS `system` lets it keep
    // following itself, which is what the setting says.
    window.shelf.window.setAppearance(mode.value);

    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          mode: mode.value,
          accent: accent.value,
          density: density.value,
          materials: materials.value,
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

  return {
    mode,
    accent,
    density,
    materials,
    appearance,
    presets,
    activePreset,
    resetMaterials,
  };
});
