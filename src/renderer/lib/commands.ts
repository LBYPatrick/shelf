import { i18next, LOCALES } from '../i18n';
import { SYNTAX_SCHEMES } from '@shared/syntaxThemes';
import { ACCENT_PRESETS, oklch } from '../styles/theme';
import { ROW_LIMITS } from '../stores/settings';
import type { useSettings, Settings } from '../stores/settings';
import type { useTheme } from '../composables/useTheme';

/**
 * Everything the palette can do, as data.
 *
 * Ported from the sibling project, and the rule that makes it work is theirs:
 * **every command sets an explicit final state**, so running it twice leaves
 * the app where running it once did. That rules out bare toggles — a "toggle
 * dark mode" command is a different action depending on what you cannot see —
 * so each boolean becomes an on/off pair and each enum one command per value.
 * You should be able to say where you want to land without knowing where you
 * are.
 *
 * `setting` names the preference a command writes. Nothing reads it at runtime;
 * it exists so a test can prove that every preference is reachable from here,
 * and so a new one cannot quietly go unreachable.
 */

export type CommandSection = 'settings' | 'navigation';

export interface Command {
  readonly id: string;
  readonly title: string;
  readonly section: CommandSection;
  readonly icon: string;
  /** The typed form, shown dimmed on the row and matched in `/` mode. */
  readonly slash: string;
  readonly keywords?: string;
  readonly setting?: keyof Settings;
  /** Shown instead of the icon when the command is choosing a colour. */
  readonly swatch?: string;
  readonly run: () => void;
}

interface BooleanSpec {
  readonly base: string;
  readonly setting?: keyof Settings;
  readonly icon: string;
  readonly onTitle: string;
  readonly offTitle: string;
  readonly keywords: string;
  readonly set: (value: boolean) => void;
}

/** The on/off pair a boolean preference becomes. */
function booleanCommands(spec: BooleanSpec): Command[] {
  return (['on', 'off'] as const).map((word) => ({
    id: `settings.${spec.base}-${word}`,
    section: 'settings' as const,
    icon: spec.icon,
    title: word === 'on' ? spec.onTitle : spec.offTitle,
    slash: `/${spec.base} ${word}`,
    keywords: spec.keywords,
    ...(spec.setting ? { setting: spec.setting } : {}),
    run: () => spec.set(word === 'on'),
  }));
}

interface EnumSpec<T> {
  readonly base: string;
  readonly setting?: keyof Settings;
  readonly icon: string;
  readonly label: string;
  /**
   * What the *group* is about, never its values.
   *
   * The option's own word is appended below, so a value word in here would put
   * "dark" on the keywords of every theme command and make `/theme dark` match
   * all three of them.
   */
  readonly keywords: string;
  readonly options: readonly {
    readonly value: T;
    readonly word: string;
    readonly label: string;
    readonly swatch?: string;
  }[];
  readonly set: (value: T) => void;
}

/** One command per value, never a cycle. */
function enumCommands<T>(spec: EnumSpec<T>): Command[] {
  return spec.options.map((option) => ({
    id: `settings.${spec.base}-${option.word}`,
    section: 'settings' as const,
    icon: spec.icon,
    title: `${spec.label}: ${option.label}`,
    slash: `/${spec.base} ${option.word}`,
    keywords: `${spec.keywords} ${option.word}`,
    ...(spec.setting ? { setting: spec.setting } : {}),
    ...(option.swatch ? { swatch: option.swatch } : {}),
    run: () => spec.set(option.value),
  }));
}

export interface CommandContext {
  readonly theme: ReturnType<typeof useTheme>;
  readonly settings: ReturnType<typeof useSettings>;
  readonly navigation: readonly Command[];
}

export function buildCommands({ theme, settings, navigation }: CommandContext): Command[] {
  const t = (key: string) => i18next.t(key);
  const values = settings.values as Settings;
  const write = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    values[key] = value;
  };

  return [
    ...navigation,

    ...enumCommands({
      base: 'theme',
      icon: 'settings',
      label: t('settings.theme'),
      keywords: 'appearance colour scheme',
      options: [
        { value: 'system' as const, word: 'system', label: t('settings.system') },
        { value: 'light' as const, word: 'light', label: t('settings.light') },
        { value: 'dark' as const, word: 'dark', label: t('settings.dark') },
      ],
      set: (value) => (theme.mode = value),
    }),

    ...enumCommands({
      base: 'accent',
      icon: 'settings',
      label: t('settings.accent'),
      keywords: 'colour color',
      options: ACCENT_PRESETS.map((preset) => ({
        value: preset.seed,
        word: preset.id,
        label: preset.name,
        swatch: oklch(preset.seed),
      })),
      set: (value) => (theme.accent = value),
    }),

    ...enumCommands({
      base: 'density',
      icon: 'tables',
      label: t('settings.density'),
      keywords: 'spacing size',
      options: [
        { value: 'compact' as const, word: 'compact', label: t('settings.compact') },
        { value: 'default' as const, word: 'default', label: t('settings.default') },
        {
          value: 'comfortable' as const,
          word: 'comfortable',
          label: t('settings.comfortable'),
        },
      ],
      set: (value) => (theme.density = value),
    }),

    ...enumCommands({
      base: 'language',
      setting: 'language',
      icon: 'info',
      label: t('settings.language'),
      keywords: 'locale translation',
      options: [
        { value: 'system' as const, word: 'system', label: t('settings.followSystem') },
        // In their own names: the person looking for a language is the one who
        // reads it.
        ...LOCALES.map((locale) => ({
          value: locale.id,
          word: locale.id.toLowerCase(),
          label: locale.endonym,
        })),
      ],
      set: (value) => write('language', value),
    }),

    ...enumCommands({
      base: 'index',
      setting: 'rowIndexBase',
      icon: 'tables',
      label: t('grid.indexLabel'),
      keywords: 'row gutter numbering',
      options: [
        { value: 1 as const, word: '1', label: t('grid.oneBased') },
        { value: 0 as const, word: '0', label: t('grid.zeroBased') },
      ],
      set: (value) => write('rowIndexBase', value),
    }),

    ...enumCommands({
      base: 'edit-on',
      setting: 'editTrigger',
      icon: 'pencil',
      label: t('settings.editTrigger'),
      keywords: 'cell editing trigger',
      options: [
        { value: 'dblclick' as const, word: 'double', label: t('settings.doubleClick') },
        { value: 'click' as const, word: 'single', label: t('settings.singleClick') },
      ],
      set: (value) => write('editTrigger', value),
    }),

    ...enumCommands({
      base: 'binary',
      setting: 'binaryEncoding',
      icon: 'structure',
      label: t('settings.binaryAs'),
      keywords: 'blob bytes encoding',
      options: [
        { value: 'hex' as const, word: 'hex', label: t('settings.hex') },
        { value: 'base64' as const, word: 'base64', label: t('settings.base64') },
      ],
      set: (value) => write('binaryEncoding', value),
    }),

    ...enumCommands({
      base: 'run',
      setting: 'primaryRun',
      icon: 'play',
      label: t('settings.primaryRun'),
      keywords: 'query enter primary',
      options: [
        { value: 'all' as const, word: 'all', label: t('settings.runAll') },
        { value: 'current' as const, word: 'current', label: t('settings.runCurrent') },
      ],
      set: (value) => write('primaryRun', value),
    }),

    ...booleanCommands({
      base: 'wrap',
      setting: 'wrapLines',
      icon: 'query',
      onTitle: t('commands.wrapOn'),
      offTitle: t('commands.wrapOff'),
      keywords: 'editor long lines soft',
      set: (value) => write('wrapLines', value),
    }),

    ...booleanCommands({
      base: 'update-check',
      setting: 'checkUpdatesOnStartup',
      icon: 'download',
      onTitle: t('commands.startupUpdatesOn'),
      offTitle: t('commands.startupUpdatesOff'),
      keywords: 'update version release launch startup automatic',
      set: (value) => write('checkUpdatesOnStartup', value),
    }),

    /*
     * One command per scheme, and it sets both halves.
     *
     * A scheme is a pair — a palette drawn for a dark background is unreadable
     * on a light one — and the sheet lets the two be chosen apart. A palette
     * row cannot: "Code colours: Nord" has to mean one thing, and a command
     * that wrote only the half matching the current appearance would land
     * somewhere different depending on the time of day. So this is the common
     * case stated explicitly — that family, in both appearances — and telling
     * them apart stays a job for the form.
     */
    ...enumCommands({
      base: 'code',
      icon: 'query',
      label: t('settings.syntax'),
      /*
       * No "theme" in here. The group's keywords must be about the group and
       * never its values — and "theme" is another group's word, so `/theme
       * dark` matched Darcula as well, "dark" being inside it.
       */
      keywords: 'syntax highlighting editor code',
      options: SYNTAX_SCHEMES.map((scheme) => ({
        value: scheme.id,
        word: scheme.id.toLowerCase(),
        label: scheme.name,
      })),
      set: (value) => (theme.syntax = { light: value, dark: value, sync: true }),
    }),

    {
      id: 'settings.materials-reset',
      section: 'settings',
      icon: 'settings',
      title: t('settings.resetMaterials'),
      slash: '/materials reset',
      keywords: 'glass opacity blur',
      run: () => theme.resetMaterials(),
    },

    /*
     * The row limit stopped being a number you type and became one of seven
     * choices, which is exactly the shape a palette row can carry: a name you
     * can say, with the answer in it.
     */
    ...enumCommands({
      base: 'rows',
      setting: 'maxRows',
      icon: 'tables',
      label: t('settings.maxRows'),
      keywords: 'limit result size truncate',
      options: ROW_LIMITS.map((value) => ({
        value,
        word: String(value),
        label: t('query.rowLimit', { rows: value.toLocaleString() }),
      })),
      set: (value) => write('maxRows', value),
    }),

    /*
     * The two remaining numeric preferences — rows per page and editor font
     * size — have no command. A palette row is a name you can say; a number you
     * have to type into a slot is a form field, and the sheet already has one.
     * The parity test names them so their absence stays deliberate.
     */
  ];
}

/** Preferences that are deliberately not reachable as commands, and why. */
export const UNCOMMANDED: readonly (keyof Settings)[] = ['pageSize', 'editorFontSize'];

/**
 * ...and the appearance options that are not, for the same reason.
 *
 * The opacity dial is a continuous value with no named stops; the row that does
 * exist for it puts it back where it started, which is the one thing about a
 * slider you can say in words.
 */
export const UNCOMMANDED_APPEARANCE: readonly string[] = ['opacity'];

/** Matches a `/…` query against the typed form of a command. */
export function matchSlash(command: Command, query: string): boolean {
  const needle = query.slice(1).trim().toLowerCase();
  if (needle === '') return true;

  const haystack = `${command.slash} ${command.title} ${command.keywords ?? ''}`.toLowerCase();
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}
