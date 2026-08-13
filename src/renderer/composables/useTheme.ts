import { defineStore } from 'pinia';
import { computed, ref, watchEffect } from 'vue';
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT,
  applyTheme,
  resolveAppearance,
  type Density,
  type Oklch,
  type ThemeMode,
} from '../styles/theme';

const STORAGE_KEY = 'shelf.appearance';

interface StoredAppearance {
  mode: ThemeMode;
  accent: Oklch;
  density: Density;
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
    });

    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ mode: mode.value, accent: accent.value, density: density.value })
      );
    } catch {
      // Persisting appearance is a convenience, never a hard requirement.
    }
  });

  return { mode, accent, density, appearance, presets, activePreset };
});
