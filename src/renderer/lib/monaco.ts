/**
 * Monaco, assembled from the parts this app actually uses.
 *
 * The package's default entry registers eighty languages and their services.
 * Importing the three pieces below instead gives the editor, every editor
 * contribution — find and replace, folding, multi-cursor, the command palette —
 * and SQL, and nothing else.
 *
 * The specifiers go through the package's `exports` map, which already points
 * at `esm/vs`: `monaco-editor/editor.js`, not `monaco-editor/esm/vs/editor.js`,
 * which resolves to `esm/vs/esm/vs/...` and fails.
 *
 * Everything is bundled from `node_modules`. Monaco's own documentation leads
 * with a CDN loader; a database client is used on machines with no route to the
 * internet and must not have a text editor that only works online.
 */
import * as monaco from 'monaco-editor/editor.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';

import 'monaco-editor/features/register.all.js';
import 'monaco-editor/languages/definitions/sql/register.js';
/*
 * JSON arrives as a language *service* rather than a tokeniser, because that is
 * the only form Monaco ships it in — and it is the form this wants anyway. A
 * settings document is edited by hand and the mistake is always a comma; a
 * marker on the line beats a message under the box.
 */
import 'monaco-editor/language/json/monaco.contribution.js';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';

/*
 * The worker is imported, so the bundler emits it as one of our own assets and
 * the path in the build points at the app. Monaco's documented setup fetches
 * the whole editor from a CDN — a database client is used on machines with no
 * route to the internet, and must not have a text editor that only works
 * online.
 */
const environment = globalThis as typeof globalThis & {
  MonacoEnvironment?: { getWorker: (id: string, label: string) => Worker };
};

environment.MonacoEnvironment = {
  getWorker: (_id, label) => (label === 'json' ? new JsonWorker() : new EditorWorker()),
};

export { monaco };

/**
 * A colour the theme resolved, as the hex Monaco insists on — alpha included.
 *
 * Monaco themes are plain data: no custom properties, no `color-mix`, no
 * `oklch`. Reading the custom property gives back the unevaluated token stream,
 * `var()` calls and all, so every colour has to be resolved on a real element
 * first and then converted.
 *
 * The conversion is the interesting part. A single canvas read cannot do it:
 * the pixel is stored premultiplied, so at five per cent alpha the recovered
 * channels are almost entirely rounding error. Painting the colour over black
 * and over white instead gives two opaque readings, and the pair determines
 * both the alpha and the underlying channels exactly.
 *
 *   over black  cb = a·C
 *   over white  cw = a·C + (1 − a)·255
 *   so          a  = 1 − (cw − cb)/255      and      C = cb/a
 *
 * Alpha is kept rather than flattened, and that is the whole point. Flattening
 * needs to know what is behind the surface, and behind this one is the material
 * the OS paints outside the window — which nothing in the page can sample. Two
 * attempts to guess it put a stripe across the editor. Handing Monaco a
 * translucent colour lets the compositor do the one part it cannot get wrong.
 */
let probeElement: HTMLElement | undefined;
let probeContext: CanvasRenderingContext2D | null | undefined;

function usedColour(value: string): string | undefined {
  if (!probeElement) {
    probeElement = document.createElement('span');
    probeElement.style.display = 'none';
    document.body.append(probeElement);
  }

  probeElement.style.color = '';
  probeElement.style.color = value.startsWith('--') ? `var(${value})` : value;
  return getComputedStyle(probeElement).color || undefined;
}

export function resolveColour(token: string, fallback: string): string {
  if (probeContext === undefined) {
    probeContext = document
      .createElement('canvas')
      .getContext('2d', { willReadFrequently: true });
  }

  const context = probeContext;
  if (!context) return fallback;

  const colour = usedColour(token);
  if (!colour) return fallback;

  const over = (backdrop: string) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = backdrop;
    context.fillRect(0, 0, 1, 1);
    context.fillStyle = colour;
    context.fillRect(0, 0, 1, 1);
    return context.getImageData(0, 0, 1, 1).data;
  };

  const onBlack = over('#000000');
  const onWhite = over('#ffffff');

  // Averaged across the channels: each yields the same alpha, and averaging
  // absorbs the one-unit rounding each of them can carry.
  const alpha = Math.min(
    1,
    Math.max(
      0,
      1 -
        [0, 1, 2].reduce((sum, i) => sum + ((onWhite[i] ?? 0) - (onBlack[i] ?? 0)), 0) / 3 / 255
    )
  );

  if (alpha < 0.004) return '#00000000';

  const hex = (value: number) =>
    Math.min(255, Math.max(0, Math.round(value)))
      .toString(16)
      .padStart(2, '0');
  const channel = (index: number) => hex((onBlack[index] ?? 0) / alpha);

  return `#${channel(0)}${channel(1)}${channel(2)}${hex(alpha * 255)}`;
}

/* ------------------------------------------------------ the editors' theme */

export const EDITOR_THEMES = { light: 'shelf-light', dark: 'shelf-dark' } as const;

/**
 * Our tokens, flattened into the plain data a Monaco theme is.
 *
 * Rebuilt whenever the appearance or the accent changes rather than defined
 * once: the accent is user-chosen, so a palette baked in at startup would be
 * the one thing in the window that did not follow it.
 */
export function defineEditorTheme(appearance: 'light' | 'dark'): void {
  // `#rrggbbaa`, alpha and all; Monaco rejects anything that is not hex.
  const token = (name: string, fallback: string) => resolveColour(name, fallback);

  monaco.editor.defineTheme(EDITOR_THEMES[appearance], {
    base: appearance === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: token('--syntax-keyword', '#7c3aed') },
      { token: 'keyword.sql', foreground: token('--syntax-keyword', '#7c3aed') },
      { token: 'operator.sql', foreground: token('--syntax-operator', '#64748b') },
      { token: 'string', foreground: token('--syntax-string', '#15803d') },
      { token: 'string.sql', foreground: token('--syntax-string', '#15803d') },
      { token: 'number', foreground: token('--syntax-number', '#c2410c') },
      { token: 'comment', foreground: token('--syntax-comment', '#94a3b8') },
      { token: 'predefined.sql', foreground: token('--syntax-function', '#2563eb') },
      { token: 'identifier', foreground: token('--color-base-content', '#1e293b') },
      { token: 'delimiter', foreground: token('--syntax-operator', '#64748b') },
    ],
    colors: {
      /*
       * Transparent, so the editor sits on the pane's own shade. An opaque
       * editor background would be a fourth surface in a stack that already
       * reads top to front, and it would ignore the opacity dial entirely.
       */
      'editor.background': '#00000000',
      'editor.foreground': token('--color-base-content', '#1e293b'),
      'editorGutter.background': '#00000000',
      'editorLineNumber.foreground': token('--syntax-comment', '#94a3b8'),
      'editorLineNumber.activeForeground': token('--color-base-content', '#1e293b'),
      'editorCursor.foreground': token('--color-primary', '#2563eb'),
      'editorIndentGuide.background1': token('--separator', '#e2e8f0'),

      /*
       * The line the caret is on is a wash, not a frame. Monaco's default draws
       * it as a two-pixel *border* the width of the longest line, which put a
       * rectangle through the code and left a stray fragment hanging off the
       * end of it.
       */
      /*
       * The caret's line: a fill, and only a fill.
       *
       * Monaco's default draws it as a two-pixel *border* the width of the
       * longest line, which puts a rectangle through the code and leaves a
       * stray fragment hanging off the end of it. The border is off and the
       * quietest fill in the ramp does the work, which is what an editor's line
       * highlight is everywhere it is done well.
       *
       * A trace of the accent rather than a grey step: it belongs to the same
       * family as the wash on the statement about to run, so the two read as
       * one idea at two strengths instead of as two unrelated marks.
       *
       * Heavier on the dark theme, and not by preference. The accent there is
       * lighter and less saturated to survive a dark surface, so the same five
       * per cent that reads as a clear band over white disappears completely.
       *
       * It stays translucent all the way to Monaco. Flattening it would need to
       * know what is behind the editor, and behind the editor is glass over the
       * material the OS paints outside the window — every guess at that landed
       * a few points off and drew a band the full width of the content.
       */
      'editor.lineHighlightBackground': token(
        appearance === 'dark'
          ? 'color-mix(in oklab, var(--color-primary) 11%, transparent)'
          : 'color-mix(in oklab, var(--color-primary) 6%, transparent)',
        '#f1f5f9'
      ),
      'editor.lineHighlightBorder': '#00000000',

      'editor.selectionBackground': token('--accent-subtle', '#dbeafe'),
      'editor.inactiveSelectionBackground': token('--fill-3', '#e2e8f0'),
      'editor.selectionHighlightBackground': token('--fill-4', '#f1f5f9'),
      'editor.wordHighlightBackground': token('--fill-4', '#f1f5f9'),

      /*
       * Matches carry the accent as a fill, and nothing is outlined.
       *
       * A border around a match draws a box through the middle of a line of
       * code; the fill already says where the match is, and saying it twice
       * only adds the box.
       */
      'editor.findMatchBackground': token('--accent-subtle', '#bfdbfe'),
      'editor.findMatchHighlightBackground': token('--fill-3', '#e2e8f0'),
      'editor.findMatchBorder': '#00000000',
      'editor.findMatchHighlightBorder': '#00000000',
      'editor.selectionHighlightBorder': '#00000000',
      'editor.wordHighlightBorder': '#00000000',

      /* The band behind the line holding the current match, for the same
         reason: the match itself is marked, which is the part that helps. */
      'editor.rangeHighlightBackground': '#00000000',
      'editor.rangeHighlightBorder': '#00000000',

      'editorBracketMatch.background': token('--fill-3', '#e2e8f0'),
      'editorBracketMatch.border': '#00000000',

      /* Widgets: find, suggest, hover, the context menu. */
      'editorWidget.background': token('--color-base-100', '#ffffff'),
      'editorWidget.foreground': token('--color-base-content', '#1e293b'),
      'editorWidget.border': token('--separator', '#e2e8f0'),
      'widget.shadow': '#00000022',
      'input.background': token('--fill-4', '#f8fafc'),
      'input.foreground': token('--color-base-content', '#1e293b'),
      'input.border': token('--separator', '#e2e8f0'),
      'input.placeholderForeground': token('--syntax-comment', '#94a3b8'),
      'inputOption.activeBackground': token('--accent-subtle', '#dbeafe'),
      'inputOption.activeBorder': '#00000000',
      'inputOption.activeForeground': token('--color-primary-text', '#1d4ed8'),
      focusBorder: token('--color-primary', '#2563eb'),
      'icon.foreground': token('--color-base-content', '#1e293b'),
      'toolbar.hoverBackground': token('--fill-4', '#f1f5f9'),
      descriptionForeground: token('--syntax-comment', '#94a3b8'),
      errorForeground: token('--color-error', '#dc2626'),

      'editorSuggestWidget.background': token('--color-base-100', '#ffffff'),
      'editorSuggestWidget.border': token('--separator', '#e2e8f0'),
      'editorSuggestWidget.foreground': token('--color-base-content', '#1e293b'),
      'editorSuggestWidget.selectedBackground': token('--accent-subtle', '#dbeafe'),
      'editorSuggestWidget.selectedForeground': token('--color-primary-text', '#1d4ed8'),
      'editorSuggestWidget.highlightForeground': token('--color-primary-text', '#1d4ed8'),

      'editorHoverWidget.background': token('--color-base-100', '#ffffff'),
      'editorHoverWidget.border': token('--separator', '#e2e8f0'),
      'editorHoverWidget.foreground': token('--color-base-content', '#1e293b'),

      'list.hoverBackground': token('--fill-4', '#f1f5f9'),
      'list.focusBackground': token('--accent-subtle', '#dbeafe'),
      'list.activeSelectionBackground': token('--accent-subtle', '#dbeafe'),
      'list.activeSelectionForeground': token('--color-primary-text', '#1d4ed8'),

      'menu.background': token('--color-base-100', '#ffffff'),
      'menu.foreground': token('--color-base-content', '#1e293b'),
      'menu.border': token('--separator', '#e2e8f0'),
      'menu.selectionBackground': token('--accent-subtle', '#dbeafe'),
      'menu.selectionForeground': token('--color-primary-text', '#1d4ed8'),

      /* The same thumb the rest of the window's scrollbars use. */
      'scrollbarSlider.background': token('--fill-3', '#cbd5e1'),
      'scrollbarSlider.hoverBackground': token('--fill-2', '#94a3b8'),
      'scrollbarSlider.activeBackground': token('--fill-1', '#64748b'),
      'editorOverviewRuler.border': '#00000000',
    },
  });

  monaco.editor.setTheme(EDITOR_THEMES[appearance]);
}
