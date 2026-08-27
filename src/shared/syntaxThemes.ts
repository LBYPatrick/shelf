/**
 * The colours a statement is drawn in.
 *
 * Eight tokens, and every place that colours code reads the same eight: the
 * query editor, the statements in a conversation, and the JSON view in
 * settings. They are CSS custom properties, so Monaco's theme, the chat's own
 * tokeniser and anything added later all follow from one assignment — the
 * alternative is three palettes that agree until somebody edits one.
 *
 * A scheme carries both appearances. That is not a convenience: a palette
 * designed for a dark background is unreadable on a light one, and a picker
 * offering "Nord" without saying which Nord would be offering to make the
 * editor illegible half the time. So a scheme is a pair, the two are chosen
 * separately, and `sync` is the shortcut for the common case of wanting the
 * same family in both.
 *
 * Pure and unit tested, because the failure is quiet: a token missing from one
 * appearance falls back to whatever the built-in palette said, which looks like
 * a deliberate accent rather than a hole.
 */

export type SyntaxToken =
  'keyword' | 'string' | 'number' | 'comment' | 'function' | 'type' | 'operator' | 'property';

export const SYNTAX_TOKENS: readonly SyntaxToken[] = [
  'keyword',
  'string',
  'number',
  'comment',
  'function',
  'type',
  'operator',
  'property',
];

export type Palette = Readonly<Record<SyntaxToken, string>>;

export interface SyntaxScheme {
  readonly id: string;
  readonly name: string;
  /** Absent on the built-in, which is whatever `base.css` already declares. */
  readonly light?: Palette;
  readonly dark?: Palette;
}

/**
 * The default is *absence*, not a copy.
 *
 * Shelf's own palette is derived in `base.css` from the same neutral the rest
 * of the theme is built from, and pasting its values here would be a second
 * copy that stops agreeing the first time either moves. Choosing "Shelf" writes
 * nothing and lets the stylesheet answer.
 */
export const DEFAULT_SCHEME = 'shelf';

const palette = (
  keyword: string,
  string_: string,
  number_: string,
  comment: string,
  fn: string,
  type: string,
  operator: string,
  property: string
): Palette => ({
  keyword,
  string: string_,
  number: number_,
  comment,
  function: fn,
  type,
  operator,
  property,
});

export const SYNTAX_SCHEMES: readonly SyntaxScheme[] = [
  { id: DEFAULT_SCHEME, name: 'Shelf' },
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    light: palette(
      '#0000ff',
      '#a31515',
      '#098658',
      '#008000',
      '#795e26',
      '#267f99',
      '#000000',
      '#001080'
    ),
    dark: palette(
      '#569cd6',
      '#ce9178',
      '#b5cea8',
      '#6a9955',
      '#dcdcaa',
      '#4ec9b0',
      '#d4d4d4',
      '#9cdcfe'
    ),
  },
  {
    id: 'nord',
    name: 'Nord',
    light: palette(
      '#5e81ac',
      '#5b7a3f',
      '#9a6b9e',
      '#8a93a3',
      '#4a8fa3',
      '#4a8f8a',
      '#5e81ac',
      '#3b4252'
    ),
    dark: palette(
      '#81a1c1',
      '#a3be8c',
      '#b48ead',
      '#616e88',
      '#88c0d0',
      '#8fbcbb',
      '#81a1c1',
      '#d8dee9'
    ),
  },
  {
    id: 'tokyoNight',
    name: 'Tokyo Night',
    light: palette(
      '#9854f1',
      '#587539',
      '#965027',
      '#848cb5',
      '#2e7de9',
      '#007197',
      '#006c86',
      '#33635c'
    ),
    dark: palette(
      '#bb9af7',
      '#9ece6a',
      '#ff9e64',
      '#565f89',
      '#7aa2f7',
      '#2ac3de',
      '#89ddff',
      '#73daca'
    ),
  },
  {
    id: 'rosePine',
    name: 'Rosé Pine',
    light: palette(
      '#286983',
      '#ea9d34',
      '#d7827e',
      '#9893a5',
      '#d7827e',
      '#56949f',
      '#797593',
      '#907aa9'
    ),
    dark: palette(
      '#31748f',
      '#f6c177',
      '#ebbcba',
      '#6e6a86',
      '#ebbcba',
      '#9ccfd8',
      '#908caa',
      '#c4a7e7'
    ),
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox',
    light: palette(
      '#9d0006',
      '#79740e',
      '#8f3f71',
      '#7c6f64',
      '#79740e',
      '#b57614',
      '#076678',
      '#427b58'
    ),
    dark: palette(
      '#fb4934',
      '#b8bb26',
      '#d3869b',
      '#928374',
      '#b8bb26',
      '#fabd2f',
      '#83a598',
      '#8ec07c'
    ),
  },
  {
    id: 'monokaiPro',
    name: 'Monokai Pro',
    light: palette(
      '#ce4770',
      '#cc7a0a',
      '#7058be',
      '#8b8681',
      '#218871',
      '#1c8ca8',
      '#ce4770',
      '#b45438'
    ),
    dark: palette(
      '#ff6188',
      '#ffd866',
      '#ab9df2',
      '#727072',
      '#a9dc76',
      '#78dce8',
      '#ff6188',
      '#fc9867'
    ),
  },
  {
    id: 'darcula',
    name: 'Darcula',
    light: palette(
      '#0033b3',
      '#067d17',
      '#1750eb',
      '#8c8c8c',
      '#00627a',
      '#0033b3',
      '#333333',
      '#871094'
    ),
    dark: palette(
      '#cc7832',
      '#6a8759',
      '#6897bb',
      '#808080',
      '#ffc66d',
      '#a9b7c6',
      '#a9b7c6',
      '#9876aa'
    ),
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    light: palette(
      '#8839ef',
      '#40a02b',
      '#fe640b',
      '#8c8fa1',
      '#1e66f5',
      '#df8e1d',
      '#04a5e5',
      '#179299'
    ),
    dark: palette(
      '#cba6f7',
      '#a6e3a1',
      '#fab387',
      '#6c7086',
      '#89b4fa',
      '#f9e2af',
      '#89dceb',
      '#94e2d5'
    ),
  },
  {
    id: 'oneDark',
    name: 'One Dark',
    light: palette(
      '#a626a4',
      '#50a14f',
      '#986801',
      '#9198a1',
      '#4078f2',
      '#c18401',
      '#0184bc',
      '#e45649'
    ),
    dark: palette(
      '#c678dd',
      '#98c379',
      '#d19a66',
      '#5c6370',
      '#61afef',
      '#e5c07b',
      '#56b6c2',
      '#e06c75'
    ),
  },
];

const BY_ID = new Map(SYNTAX_SCHEMES.map((scheme) => [scheme.id, scheme]));

/** Unknown ids fall back rather than throwing: a stored setting outlives a build. */
export function syntaxScheme(id: string): SyntaxScheme {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_SCHEME)!;
}

/**
 * The custom properties to set for one scheme in one appearance.
 *
 * Empty for the built-in, which is the point: nothing is written, so the
 * stylesheet's own derivation stands. Anything already on the element from a
 * previous choice has to be cleared by the caller — see `applyTheme`.
 */
export function syntaxProperties(
  id: string,
  appearance: 'light' | 'dark'
): Palette | undefined {
  return syntaxScheme(id)[appearance];
}
