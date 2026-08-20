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
import { EDITOR_THEMES, defineEditorTheme, monaco } from '../../lib/monaco';
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

  defineEditorTheme(theme.appearance);
  registerCompletions();

  editor = monaco.editor.create(host.value, {
    value: model.value,
    language: 'sql',
    theme: EDITOR_THEMES[theme.appearance],
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
  (appearance) => defineEditorTheme(appearance)
);

watch(
  () => theme.accent,
  () => defineEditorTheme(theme.appearance),
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
