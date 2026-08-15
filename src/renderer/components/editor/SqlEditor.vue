<script setup lang="ts">
/**
 * The query editor.
 *
 * Monaco, because a database client's editor is judged against the editor
 * people already use: find and replace, multi-cursor, folding, go-to-line and
 * the whole command palette are things you expect to be there, and writing a
 * second-rate version of each is the alternative to bringing one that has them.
 *
 * It is imperative and owns its own DOM, so it is created once and fed changes
 * rather than re-rendered. The only reactive traffic is the value going out,
 * and the schema and preferences coming in.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { statementAt, type Statement } from '@shared/sqlText';
import { monaco, resolveColour } from '../../lib/monaco';
import { useSettings } from '../../stores/settings';
import { useTheme } from '../../composables/useTheme';

/** Table name to its column names, which is all the completer needs. */
export type SchemaMap = Record<string, readonly string[]>;

const props = defineProps<{
  schema?: SchemaMap;
  readOnly?: boolean;
}>();

const emit = defineEmits<{
  run: [];
  runCurrent: [];
  /** Fires when the cursor moves, with the statement it now sits in. */
  statementChange: [Statement | null];
}>();

const model = defineModel<string>({ required: true });

const settings = useSettings();
const theme = useTheme();

const host = ref<HTMLElement>();
let editor: monaco.editor.IStandaloneCodeEditor | undefined;
let completions: monaco.IDisposable | undefined;
let statementMarks: monaco.editor.IEditorDecorationsCollection | undefined;
/** Set while writing the model from the outside, so the change is not echoed. */
let applyingExternal = false;

/* ------------------------------------------------------------- appearance */

const THEMES = { light: 'shelf-light', dark: 'shelf-dark' } as const;

/**
 * Our tokens, flattened into the plain data a Monaco theme is.
 *
 * Rebuilt whenever the appearance or the accent changes rather than defined
 * once: the accent is user-chosen, so a palette baked in at startup would be
 * the one thing in the window that did not follow it.
 */
function defineTheme(appearance: 'light' | 'dark'): void {
  // `#rrggbbaa`, alpha and all; Monaco rejects anything that is not hex.
  const token = (name: string, fallback: string) => resolveColour(name, fallback);

  monaco.editor.defineTheme(THEMES[appearance], {
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

  monaco.editor.setTheme(THEMES[appearance]);
}

/* ------------------------------------------------------------ completions */

/**
 * Table and column names, offered from the schema the sidebar already loaded.
 *
 * Registered per editor instance and disposed with it, because a provider
 * registered globally would outlive the tab and start answering for a
 * connection that is no longer open.
 */
function registerCompletions(): void {
  completions?.dispose();

  completions = monaco.languages.registerCompletionItemProvider('sql', {
    provideCompletionItems: (textModel, position) => {
      const word = textModel.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const schema = props.schema ?? {};
      const suggestions: monaco.languages.CompletionItem[] = [];

      for (const [table, columns] of Object.entries(schema)) {
        suggestions.push({
          label: table,
          kind: monaco.languages.CompletionItemKind.Struct,
          insertText: table,
          /*
           * The count only when there is one. A table's columns are not loaded
           * until it is expanded in the sidebar, so every unexpanded table was
           * offering itself as having "0 columns" — which is not a smaller
           * truth than the real number, it is a false one.
           */
          ...(columns.length > 0 ? { detail: `${columns.length} columns` } : {}),
          range,
        });

        for (const column of columns) {
          suggestions.push({
            label: column,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: column,
            detail: table,
            range,
          });
        }
      }

      return { suggestions };
    },
  });
}

/* ------------------------------------------------- the statement in force */

function reportStatement(): void {
  if (!editor) return;

  const textModel = editor.getModel();
  const position = editor.getPosition();
  if (!textModel || !position) return;

  const text = textModel.getValue();
  const found = statementAt(text, textModel.getOffsetAt(position));
  emit('statementChange', found.text ? found : null);

  /*
   * Marked only when there is more than one statement to tell apart.
   *
   * With a single statement the mark covers everything it could cover, which
   * says nothing and leaves a wash behind text on lines the caret is nowhere
   * near — the obvious reading of which is "why is that highlighted?". The
   * answer used to be "because it is the statement", and when that is all of
   * them it is not worth saying.
   */
  const single = found.text === text.trim();

  statementMarks?.set(
    found.text && !single
      ? [
          {
            range: monaco.Range.fromPositions(
              textModel.getPositionAt(found.from),
              textModel.getPositionAt(found.to)
            ),
            /*
             * Whole lines, not the characters. A wash fitted to the text draws
             * a box around some words, which reads as a highlight on those
             * words rather than as "this block is what runs".
             */
            options: { className: 'sql-current-statement', isWholeLine: true },
          },
        ]
      : []
  );
}

/* ------------------------------------------------------ what the tab shows */

const lineCount = ref(1);
const cursor = ref({ line: 1, column: 1 });
const selectedChars = ref(0);

/**
 * The editor's own vitals, for the status bar.
 *
 * Line and column because an error that says "near line 14" is useless without
 * them, and a selection length because "how much did I just highlight" is the
 * other question the bar can answer for free.
 */
const stats = computed(() => ({
  lines: lineCount.value,
  line: cursor.value.line,
  column: cursor.value.column,
  selected: selectedChars.value,
}));

defineExpose({
  focus: () => editor?.focus(),
  /** The text the user has selected, if any. */
  selection: () => {
    const selection = editor?.getSelection();
    if (!selection || !editor) return '';
    return editor.getModel()?.getValueInRange(selection) ?? '';
  },
  stats,
});

/* ------------------------------------------------------------- life cycle */

onMounted(() => {
  if (!host.value) return;

  defineTheme(theme.appearance);
  registerCompletions();

  editor = monaco.editor.create(host.value, {
    value: model.value,
    language: 'sql',
    theme: THEMES[theme.appearance],
    readOnly: props.readOnly ?? false,
    automaticLayout: true,
    fontFamily: 'var(--font-mono)',
    fontSize: settings.values.editorFontSize,
    wordWrap: settings.values.wrapLines ? 'on' : 'off',
    minimap: { enabled: false },
    /*
     * Sticky scroll, off.
     *
     * It pins the enclosing scope to the top of the viewport, and it has to
     * occlude the text scrolling underneath to do that. This editor's
     * background is deliberately translucent — the surface behind it is the
     * material the OS paints outside the window, which nothing in the page can
     * sample, so the well keeps its alpha and lets the compositor resolve it.
     * A widget with nothing to paint over the scroll with draws straight
     * through it: line one appeared over line seven, both legible, neither
     * readable. And what it would be pinning here is the word SELECT, which is
     * not the kind of context a nested block needs it for.
     */
    stickyScroll: { enabled: false },
    // The tab already has a status bar; a second one inside the editor would
    // say the same things twice.
    scrollBeyondLastLine: false,
    renderLineHighlight: 'line',
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    padding: { top: 8, bottom: 8 },
    scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9, useShadows: false },
    overviewRulerLanes: 0,
    guides: { indentation: false },
    // Monaco puts an accessibility hint in the editor by default; ours is a
    // one-line SQL box far more often than it is a source file.
    accessibilitySupport: 'auto',
    contextmenu: true,
  });

  statementMarks = editor.createDecorationsCollection();

  /*
   * Run bindings are commands rather than keydown handlers so they take
   * precedence over Monaco's own chords, and so they show up in its command
   * palette with the right accelerator beside them.
   */
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => emit('run'));
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () =>
    emit('runCurrent')
  );

  editor.onDidChangeModelContent(() => {
    if (applyingExternal) return;
    model.value = editor?.getValue() ?? '';
    lineCount.value = editor?.getModel()?.getLineCount() ?? 1;
    reportStatement();
  });

  editor.onDidChangeCursorPosition((event) => {
    cursor.value = { line: event.position.lineNumber, column: event.position.column };
    reportStatement();
  });

  editor.onDidChangeCursorSelection((event) => {
    const textModel = editor?.getModel();
    selectedChars.value = textModel ? textModel.getValueInRange(event.selection).length : 0;
  });

  lineCount.value = editor.getModel()?.getLineCount() ?? 1;
  reportStatement();
});

onBeforeUnmount(() => {
  completions?.dispose();
  completions = undefined;
  editor?.dispose();
  editor = undefined;
});

// External changes — loading a saved query — are written in without disturbing
// the cursor if the text is already what we have.
watch(model, (value) => {
  if (!editor || value === editor.getValue()) return;
  applyingExternal = true;
  editor.setValue(value);
  applyingExternal = false;
  lineCount.value = editor.getModel()?.getLineCount() ?? 1;
});

watch(() => props.schema, registerCompletions);

watch(
  () => theme.appearance,
  (appearance) => defineTheme(appearance)
);

watch(
  () => theme.accent,
  () => defineTheme(theme.appearance),
  { deep: true }
);

watch(
  () => [settings.values.editorFontSize, settings.values.wrapLines] as const,
  ([fontSize, wrap]) => {
    editor?.updateOptions({ fontSize, wordWrap: wrap ? 'on' : 'off' });
  }
);
</script>

<template>
  <div
    ref="host"
    class="editor"
  />
</template>

<style scoped>
.editor {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

/*
 * The statement the cursor is in, marked so "run current" is never a surprise.
 *
 * A band across its lines rather than a shape fitted to its characters: the
 * point is to say *which lines run*, and a rounded box hugging the words says
 * "these words are special" instead.
 */
.editor :deep(.sql-current-statement) {
  background-color: color-mix(in oklab, var(--color-primary) 9%, transparent);
}

/*
 * Weaker on the dark theme, where it stacks with a caret line that already has
 * to be heavier to register — the two together were more blue than the code.
 */
[data-theme='shelf-dark'] .editor :deep(.sql-current-statement) {
  background-color: color-mix(in oklab, var(--color-primary) 6%, transparent);
}
</style>
