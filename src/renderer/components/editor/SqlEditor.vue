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
import { sqlWords, type SqlWordKind } from '@shared/sqlKeywords';
import { statementAt, type Statement } from '@shared/sqlText';
import type { EngineId } from '@drivers/types';
import { EDITOR_THEMES, defineEditorTheme, monaco } from '../../lib/monaco';
import { useSettings } from '../../stores/settings';
import { useTheme } from '../../composables/useTheme';

/**
 * One entity the completer can offer, and what is inside it.
 *
 * A map of name to columns was the shape before, and it lost the two things a
 * qualified engine needs: which namespace a table is in, and that the namespace
 * is a name you can type. So `public.` offered nothing, and two tables called
 * `users` in two schemas were one entry — the second overwrote the first, and
 * whichever set of columns arrived last was the answer for both.
 */
export interface SchemaTable {
  readonly name: string;
  /** Absent on an engine with no namespaces, which is what MySQL looks like. */
  readonly schema?: string;
  readonly columns: readonly string[];
}

/** Everything the completer knows about the connected database. */
export interface EditorSchema {
  readonly schemas: readonly string[];
  readonly tables: readonly SchemaTable[];
}

const props = defineProps<{
  schema?: EditorSchema;
  /** Which dialect's own words to offer; without one, only the schema is. */
  engine?: EngineId;
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

const WORD_KINDS: Record<SqlWordKind, monaco.languages.CompletionItemKind> = {
  keyword: monaco.languages.CompletionItemKind.Keyword,
  function: monaco.languages.CompletionItemKind.Function,
  type: monaco.languages.CompletionItemKind.TypeParameter,
};

/**
 * The reader's own schema first, then the dialect's words.
 *
 * Monaco sorts by how well an item matches what was typed and breaks ties on
 * `sortText`, so this only decides the ties — and a tie between a table called
 * `users` and the word `USING` should go to the table. A column belongs above a
 * keyword for the same reason and below its own table, which is the more
 * specific thing to have asked for.
 *
 * A schema sits under both and over the dialect. It is a name the reader has to
 * be able to reach — that is the whole of what was missing — but there are a
 * handful of them against hundreds of tables, and the way anyone reaches one is
 * by typing enough of it to match, which `sortText` does not decide.
 */
const ORDER = {
  table: '1',
  column: '2',
  schema: '3',
  keyword: '4',
  function: '5',
  type: '6',
};

/** The qualified name, when the engine has namespaces to qualify with. */
const tableLabel = (table: SchemaTable) =>
  table.schema ? `${table.schema}.${table.name}` : table.name;

/**
 * The identifier the caret is reaching into, if it is reaching into one.
 *
 * `users.` and `public.users.` are the two questions worth answering, and both
 * are answered by reading backwards from the start of the word being typed:
 * everything that is a run of identifier characters separated by dots. Monaco
 * does not treat `.` as a word character, so the word itself never contains the
 * qualifier and the replacement range is right without adjustment.
 */
function qualifierAt(
  textModel: monaco.editor.ITextModel,
  position: monaco.Position,
  wordStart: number
): string[] {
  const before = textModel
    .getValueInRange({
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: 1,
      endColumn: wordStart,
    })
    .trimEnd();

  if (!before.endsWith('.')) return [];

  const match = /(?:[A-Za-z_$][\w$]*\.)+$/.exec(before);
  return match ? match[0].slice(0, -1).split('.') : [];
}

/**
 * Table and column names from the schema the sidebar already loaded, and the
 * words the engine itself understands.
 *
 * The dialect's words are the half that was missing: a completer that knew
 * `albums` but not `SELECT` finished the easy half of every statement. They are
 * declared per engine in `shared/sqlKeywords.ts` rather than guessed, so a
 * MySQL editor does not offer `jsonb`.
 *
 * Schemas are the other half that was missing, and their absence was the more
 * confusing one: a Postgres reader typing `pub` was offered every table in the
 * database and not the namespace they were reaching for, and `public.` was
 * offered nothing at all — a list that goes empty after a dot reads as "there
 * is nothing here", which is the opposite of true.
 *
 * What a dot means is decided before anything is offered, because the answer
 * after one is a *different list* rather than the same list filtered: after a
 * schema, its tables; after a table, its columns; after neither, everything.
 * Offering all of it either way is what makes a completer noise.
 *
 * Registered per editor instance and disposed with it, because a provider
 * registered globally would outlive the tab and start answering for a
 * connection that is no longer open.
 */
function registerCompletions(): void {
  completions?.dispose();

  completions = monaco.languages.registerCompletionItemProvider('sql', {
    // A dot is not a word character, so nothing re-opens the list after one
    // unless it is asked for.
    triggerCharacters: ['.'],

    provideCompletionItems: (textModel, position) => {
      const word = textModel.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const schemas = props.schema?.schemas ?? [];
      const tables = props.schema?.tables ?? [];
      const suggestions: monaco.languages.CompletionItem[] = [];

      const column = (name: string, from: string) => ({
        label: name,
        kind: monaco.languages.CompletionItemKind.Field,
        insertText: name,
        detail: from,
        sortText: `${ORDER.column}${name}`,
        range,
      });

      const table = (entity: SchemaTable, insert: string) => ({
        label: insert,
        kind: monaco.languages.CompletionItemKind.Struct,
        insertText: insert,
        /*
         * The count only when there is one. A table's columns are not loaded
         * until it is expanded in the sidebar, so every unexpanded table was
         * offering itself as having "0 columns" — which is not a smaller
         * truth than the real number, it is a false one.
         */
        ...(entity.columns.length > 0 ? { detail: `${entity.columns.length} columns` } : {}),
        sortText: `${ORDER.table}${insert}`,
        range,
      });

      const parts = qualifierAt(textModel, position, word.startColumn);
      const lower = (value: string) => value.toLowerCase();

      if (parts.length > 0) {
        const last = lower(parts[parts.length - 1]!);
        const owner = parts.length > 1 ? lower(parts[parts.length - 2]!) : undefined;

        /*
         * A name can be both — Postgres will happily hold a schema called
         * `audit` and a table called `audit` — so both readings are offered
         * rather than the first one that matches winning silently.
         */
        if (schemas.some((name) => lower(name) === last)) {
          for (const entity of tables) {
            if (entity.schema && lower(entity.schema) === last) {
              suggestions.push(table(entity, entity.name));
            }
          }
        }

        for (const entity of tables) {
          if (lower(entity.name) !== last) continue;
          if (owner && entity.schema && lower(entity.schema) !== owner) continue;
          for (const name of entity.columns) suggestions.push(column(name, tableLabel(entity)));
        }

        return { suggestions };
      }

      for (const name of schemas) {
        suggestions.push({
          label: name,
          kind: monaco.languages.CompletionItemKind.Module,
          insertText: name,
          sortText: `${ORDER.schema}${name}`,
          range,
        });
      }

      for (const entity of tables) {
        suggestions.push(table(entity, entity.name));
        /*
         * And again qualified, so `music.album` can be typed as one word. Only
         * where there is a schema to qualify with, and never as a second entry
         * for an engine that has none.
         */
        if (entity.schema) suggestions.push(table(entity, tableLabel(entity)));

        for (const name of entity.columns) suggestions.push(column(name, tableLabel(entity)));
      }

      for (const dialect of sqlWords(props.engine)) {
        suggestions.push({
          label: dialect.text,
          kind: WORD_KINDS[dialect.kind],
          insertText: dialect.text,
          sortText: `${ORDER[dialect.kind]}${dialect.text}`,
          range,
        });
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

watch([() => props.schema, () => props.engine], registerCompletions);

watch(
  () => theme.appearance,
  (appearance) => defineEditorTheme(appearance)
);

watch(
  () => theme.accent,
  () => defineEditorTheme(theme.appearance),
  { deep: true }
);

/*
 * Monaco's theme is a snapshot of the custom properties, taken when it is
 * defined — so a scheme chosen in settings changes the variables and nothing
 * else until the theme is built again from them.
 */
watch(
  () => theme.syntax,
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
  <div ref="host" class="editor" />
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
