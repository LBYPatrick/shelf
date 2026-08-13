<script setup lang="ts">
/**
 * The query editor.
 *
 * CodeMirror is imperative and owns its own DOM, so it is created once and fed
 * changes rather than re-rendered. The only reactive traffic is the value going
 * out and schema completions coming in.
 */
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { sql, type SQLNamespace } from '@codemirror/lang-sql';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type DecorationSet,
} from '@codemirror/view';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { shelfEditorTheme } from '../../styles/codemirror';

const props = defineProps<{
  /** Table and column names offered as completions. */
  schema?: SQLNamespace;
  readOnly?: boolean;
}>();

const emit = defineEmits<{
  run: [];
  runCurrent: [];
  /** Fires when the cursor moves, with the statement it now sits in. */
  statementChange: [{ text: string; from: number; to: number } | null];
}>();

const model = defineModel<string>({ required: true });

const host = ref<HTMLElement>();
let view: EditorView | undefined;

const schemaCompartment = new Compartment();

/** Marks the statement under the cursor so "run current" is never a surprise. */
const setCurrentStatement = StateEffect.define<{ from: number; to: number } | null>();
const currentStatementField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setCurrentStatement)) continue;
      const range = effect.value;
      return range && range.to > range.from
        ? Decoration.set([
            Decoration.mark({ class: 'cm-currentStatement' }).range(range.from, range.to),
          ])
        : Decoration.none;
    }
    return value.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Finds the statement containing the cursor by walking outward to the nearest
 * semicolons. Semicolons inside string literals and comments are skipped, so a
 * statement containing `';'` is not cut in half.
 */
function statementAt(
  text: string,
  position: number
): { text: string; from: number; to: number } {
  const boundaries = [0];

  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (inSingle) {
      if (char === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (char === '"') inDouble = false;
      continue;
    }

    if (char === '-' && next === '-') inLineComment = true;
    else if (char === '/' && next === '*') inBlockComment = true;
    else if (char === "'") inSingle = true;
    else if (char === '"') inDouble = true;
    else if (char === ';') boundaries.push(index + 1);
  }

  boundaries.push(text.length);

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const from = boundaries[index]!;
    const to = boundaries[index + 1]!;
    if (position >= from && position <= to) {
      const slice = text.slice(from, to);
      const leading = slice.length - slice.trimStart().length;
      return {
        text: slice.trim(),
        from: from + leading,
        to: from + leading + slice.trim().length,
      };
    }
  }

  return { text: text.trim(), from: 0, to: text.length };
}

function reportStatement(state: EditorState): void {
  const found = statementAt(state.doc.toString(), state.selection.main.head);
  emit('statementChange', found.text ? found : null);

  view?.dispatch({
    effects: setCurrentStatement.of(found.text ? { from: found.from, to: found.to } : null),
  });
}

onMounted(() => {
  if (!host.value) return;

  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: model.value,
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        autocompletion({ activateOnTyping: true, icons: false }),
        currentStatementField,
        schemaCompartment.of(sql({ upperCaseKeywords: true, schema: props.schema })),
        shelfEditorTheme(),
        EditorView.lineWrapping,
        EditorState.readOnly.of(props.readOnly ?? false),
        keymap.of([
          // Run bindings come first so they win over anything default.
          { key: 'Mod-Enter', run: () => (emit('run'), true), preventDefault: true },
          {
            key: 'Shift-Mod-Enter',
            run: () => (emit('runCurrent'), true),
            preventDefault: true,
          },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) model.value = update.state.doc.toString();
          if (update.docChanged || update.selectionSet) reportStatement(update.state);
        }),
      ],
    }),
  });

  reportStatement(view.state);
});

onBeforeUnmount(() => {
  view?.destroy();
  view = undefined;
});

// External changes — loading a saved query — are written in without disturbing
// the cursor if the text is already what we have.
watch(model, (value) => {
  if (!view || value === view.state.doc.toString()) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
});

watch(
  () => props.schema,
  (schema) => {
    view?.dispatch({
      effects: schemaCompartment.reconfigure(sql({ upperCaseKeywords: true, schema })),
    });
  }
);

defineExpose({
  focus: () => view?.focus(),
  /** The text the user has selected, if any. */
  selection: () => {
    if (!view) return '';
    const { from, to } = view.state.selection.main;
    return view.state.sliceDoc(from, to);
  },
});
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
</style>
