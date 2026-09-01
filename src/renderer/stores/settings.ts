import { UNLIMITED } from '@shared/rowLimit';
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
  /**
   * Whether to look for a newer build a moment after launch.
   *
   * On by default, because the alternative is an app that stays on the version
   * it was installed at until somebody thinks to go looking — and the check is
   * one request that says nothing at all unless there is something to say. It
   * is a switch rather than a fact because the request leaves the machine, and
   * that is always somebody's decision to make.
   */
  checkUpdatesOnStartup: boolean;
}

/**
 * Exported so a test can enumerate the preferences that exist.
 *
 * The palette has a command for each of them, and the parity test uses this to
 * prove it — a preference added here and nowhere else would otherwise simply be
 * unreachable, with nothing to say so.
 */
export const DEFAULTS_FOR_TEST = () => DEFAULTS;

/**
 * The row limits offered, everywhere they are offered.
 *
 * A free number box was the wrong control for this: it is set before almost
 * every run, from the toolbar, and typing four digits is not a thing to do
 * between writing a query and running it. Five hundred is the default because
 * it is the size at which you are still *looking* at rows rather than holding
 * them — anything larger is a question for an export, which streams and never
 * enters this process.
 */
export const ROW_LIMITS: readonly number[] = [
  10,
  100,
  500,
  1000,
  2000,
  5000,
  10_000,
  UNLIMITED,
];

/**
 * The list as a control sees it, in one place.
 *
 * Two dropdowns offer this — the query bar's and the one in Settings — and they
 * are the same list of the same numbers with the same rule about a value saved
 * before the list existed. Written twice, they were two places for that rule to
 * drift apart in.
 */
export function rowLimitOptions(
  saved: number,
  t: (key: string, vars?: Record<string, unknown>) => string
): { value: string; label: string }[] {
  const values = ROW_LIMITS.includes(saved)
    ? [...ROW_LIMITS]
    : [...ROW_LIMITS, saved].sort((a, b) => a - b);

  return values.map((value) => ({
    value: String(value),
    // "Unlimited" is a different kind of answer from "500 rows", and saying
    // "9,007,199,254,740,991 rows" is not a way of saying it.
    label:
      value >= UNLIMITED
        ? t('query.rowLimitNone')
        : t('query.rowLimit', { rows: value.toLocaleString() }),
  }));
}

const DEFAULTS: Settings = {
  pageSize: 100,
  maxRows: 500,
  editTrigger: 'dblclick',
  binaryEncoding: 'hex',
  rowIndexBase: 1,
  primaryRun: 'all',
  editorFontSize: 13,
  wrapLines: true,
  language: 'system',
  checkUpdatesOnStartup: true,
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
