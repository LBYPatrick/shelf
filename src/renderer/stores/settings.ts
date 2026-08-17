import { defineStore } from 'pinia';
import { saveSetting } from '../lib/settings';
import { ref, watch } from 'vue';
import { changeLocale, resolveLocale, type LanguagePreference } from '../i18n';
import { usePlatform } from '../composables/usePlatform';

/**
 * Preferences that are not appearance.
 *
 * They persist through the main process rather than localStorage because the
 * app database is the thing that gets backed up and moved between machines,
 * and because some of these need to be readable before the window exists.
 */
export interface Settings {
  /** Rows fetched per page in the data grid. */
  pageSize: number;
  /** Ceiling on rows a query may return before the result is truncated. */
  maxRows: number;
  /** How a cell enters edit mode. */
  editTrigger: 'dblclick' | 'click';
  /** How binary values are rendered. */
  binaryEncoding: 'hex' | 'base64';
  /**
   * Where the grid's row numbers start. A database person counting rows and a
   * programmer indexing an array want different answers, and both are right.
   */
  rowIndexBase: 0 | 1;
  /** Which run action the primary button performs. */
  primaryRun: 'all' | 'current';
  editorFontSize: number;
  wrapLines: boolean;
  /** `system` follows the OS; anything else is an explicit choice. */
  language: LanguagePreference;
}

/**
 * Exported so a test can enumerate the preferences that exist.
 *
 * The palette has a command for each of them, and the parity test uses this to
 * prove it — a preference added here and nowhere else would otherwise simply be
 * unreachable, with nothing to say so.
 */
export const DEFAULTS_FOR_TEST = () => DEFAULTS;

const DEFAULTS: Settings = {
  pageSize: 100,
  maxRows: 50_000,
  editTrigger: 'dblclick',
  binaryEncoding: 'hex',
  rowIndexBase: 1,
  primaryRun: 'all',
  editorFontSize: 13,
  wrapLines: true,
  language: 'system',
};

export const useSettings = defineStore('settings', () => {
  const platform = usePlatform();
  const values = ref<Settings>({ ...DEFAULTS });
  const loaded = ref(false);

  const ready = window.shelf.db
    .getSetting<Partial<Settings>>('preferences', {})
    .then((stored) => {
      values.value = { ...DEFAULTS, ...stored };
      loaded.value = true;
    })
    .catch(() => {
      loaded.value = true;
    });

  watch(
    values,
    (next) => {
      // Nothing is written until the stored values have been read, or the first
      // save would overwrite them with defaults.
      if (!loaded.value) return;
      void saveSetting('preferences', { ...next });
      void changeLocale(resolveLocale(next.language, platform.info.locale));
    },
    { deep: true }
  );

  function reset(): void {
    values.value = { ...DEFAULTS };
  }

  return { values, ready, loaded, reset, DEFAULTS };
});
