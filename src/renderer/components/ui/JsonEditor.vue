<script setup lang="ts">
/**
 * A JSON document, editable.
 *
 * The same editor the query tab uses, wearing the same theme, because a second
 * text editor with its own keybindings and its own idea of what a bracket looks
 * like is how an app starts feeling like two apps.
 *
 * Monaco's JSON support is a language *service* rather than a tokeniser, which
 * is what makes it worth reaching for here: a hand-edited settings document
 * fails on a comma, and a red squiggle on the line beats a sentence under the
 * box saying a position number.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { EDITOR_THEMES, defineEditorTheme, monaco } from '../../lib/monaco';
import { useSettings } from '../../stores/settings';
import { useTheme } from '../../composables/useTheme';

const props = defineProps<{ label: string; readOnly?: boolean }>();
const model = defineModel<string>({ required: true });

const settings = useSettings();
const theme = useTheme();

const host = ref<HTMLElement>();
let editor: monaco.editor.IStandaloneCodeEditor | undefined;
/** Set while writing the model from outside, so the change is not echoed. */
let applyingExternal = false;

onMounted(() => {
  if (!host.value) return;

  defineEditorTheme(theme.appearance);

  editor = monaco.editor.create(host.value, {
    value: model.value,
    language: 'json',
    theme: EDITOR_THEMES[theme.appearance],
    readOnly: props.readOnly ?? false,
    automaticLayout: true,
    fontSize: settings.values.editorFontSize,
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono'),
    minimap: { enabled: false },
    /*
     * No gutter decoration beyond the numbers. This is a settings file of forty
     * lines in a sheet, not a source tree: folding arrows and a glyph margin
     * spend width on affordances there is nothing here to use them for.
     */
    glyphMargin: false,
    folding: false,
    lineNumbersMinChars: 3,
    lineDecorationsWidth: 6,
    scrollBeyondLastLine: false,
    renderLineHighlight: 'line',
    tabSize: 2,
    wordWrap: 'on',
    padding: { top: 8, bottom: 8 },
    scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9 },
    ariaLabel: props.label,
  });

  editor.onDidChangeModelContent(() => {
    if (applyingExternal) return;
    model.value = editor?.getValue() ?? '';
  });
});

watch(model, (value) => {
  if (!editor || value === editor.getValue()) return;
  applyingExternal = true;
  editor.setValue(value);
  applyingExternal = false;
});

watch(
  () => theme.appearance,
  (appearance) => defineEditorTheme(appearance)
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
  () => settings.values.editorFontSize,
  (fontSize) => editor?.updateOptions({ fontSize })
);

onBeforeUnmount(() => {
  editor?.dispose();
  editor = undefined;
});
</script>

<template>
  <div
    ref="host"
    class="jsoneditor"
  />
</template>

<style scoped>
.jsoneditor {
  width: 100%;
  height: 100%;
  min-height: 0;
}
</style>
