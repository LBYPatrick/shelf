<script setup lang="ts">
/**
 * The keymap, in the two ways it is worth editing.
 *
 * A list of chords is a reference, and it was one: Settings showed every
 * binding and offered no way to change any of them. Changing one is a different
 * act from changing a preference — you do it by *doing* it — so it has its own
 * sheet rather than a fifth section in the settings form.
 *
 * **Select, record, save.** Clicking a chord arms the row and every keystroke
 * from then on is captured rather than obeyed, which is the only way to bind ⌘K
 * from inside an app that already uses ⌘K. Nothing is written until the tick,
 * because a shortcut recorded the instant a key lands cannot be corrected — the
 * correction is itself a keystroke, and it would be recorded too.
 *
 * **And the whole map is a document**, for the same reason settings are: the
 * form is the good way to change one and a file is the good way to move forty.
 * Both edit the same state; there is no third copy.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { acceleratorFrom, keymapConflicts, parseKeymap, serializeKeymap } from '@shared/keymap';
import {
  DEFAULT_BINDINGS,
  applyOverrides,
  bindings,
  currentOverrides,
  displayKeys,
  isMac,
  resetKeymap,
  setBinding,
} from '../../lib/keybindings';
import { useToasts } from '../../stores/toasts';
import AppIcon from '../ui/AppIcon.vue';
import JsonEditor from '../ui/JsonEditor.vue';
import PressButton from '../ui/PressButton.vue';
import SegmentedControl from '../ui/SegmentedControl.vue';
import Sheet from '../ui/Sheet.vue';
import { vTip } from '../../lib/hoverTip';

const open = defineModel<boolean>({ required: true });

const { t } = useTranslation();
const toasts = useToasts();

const view = ref<'visual' | 'json'>('visual');

const views = computed(() => [
  { value: 'visual' as const, label: t('settings.viewVisual') },
  { value: 'json' as const, label: t('settings.viewJson') },
]);

const groups = computed(() => [...new Set(bindings.value.map((binding) => binding.group))]);
const bindingsIn = (group: string) =>
  bindings.value.filter((binding) => binding.group === group);

const defaultKeys = (id: string) =>
  DEFAULT_BINDINGS.find((binding) => binding.id === id)?.keys ?? [];

const isChanged = (id: string) => currentOverrides()[id] !== undefined;

/**
 * The chords more than one action claims.
 *
 * Reported rather than refused: the hotkey layer resolves a collision by taking
 * the first, and there are honest pairs — an editor binding and a grid binding
 * that are never live at once. What is not honest is letting someone bind ⌘T
 * over the new tab and find out later, so the warning sits on the row.
 */
const clashes = computed(() => {
  const byId = new Map<string, string[]>();
  for (const conflict of keymapConflicts(bindings.value)) {
    for (const id of conflict.ids) {
      const others = conflict.ids
        .filter((other) => other !== id)
        .map((other) => bindings.value.find((b) => b.id === other)?.label ?? other);
      byId.set(id, [...(byId.get(id) ?? []), ...others]);
    }
  }
  return byId;
});

/* ── Recording ─────────────────────────────────────────────────────────── */

const recording = ref('');
const captured = ref('');

/**
 * In the capture phase, and stopped dead.
 *
 * Anything less and the app acts on the chord being recorded — which is exactly
 * the chord somebody is most likely to be rebinding.
 */
function onKey(event: KeyboardEvent): void {
  if (!recording.value) return;
  event.preventDefault();
  event.stopPropagation();

  // Escape is the way out of a recorder, so it is never a thing a recorder
  // records. Nothing in this app binds it either.
  if (event.key === 'Escape') {
    stopRecording();
    return;
  }

  const accelerator = acceleratorFrom(event, isMac);
  // A modifier held on its own is a chord still being typed, not a chord.
  if (accelerator) captured.value = accelerator;
}

function startRecording(id: string): void {
  recording.value = id;
  captured.value = '';
  window.addEventListener('keydown', onKey, true);
}

function stopRecording(): void {
  recording.value = '';
  captured.value = '';
  window.removeEventListener('keydown', onKey, true);
}

function commit(): void {
  if (!recording.value || !captured.value) return;
  setBinding(recording.value, [captured.value]);
  stopRecording();
}

function restore(id: string): void {
  setBinding(id, defaultKeys(id));
}

onBeforeUnmount(stopRecording);

// A sheet closed mid-recording must not leave a listener eating the keyboard.
watch(open, (isOpen) => {
  if (!isOpen) stopRecording();
});

/* ── The document ──────────────────────────────────────────────────────── */

const jsonText = ref(serializeKeymap(bindings.value));

/** A snapshot, retaken whenever the view is entered — the form may have moved. */
watch(view, (next) => {
  if (next === 'json') jsonText.value = serializeKeymap(bindings.value);
  else stopRecording();
});

const jsonError = computed(() => {
  const result = parseKeymap(jsonText.value, DEFAULT_BINDINGS);
  return result.ok ? '' : result.error;
});

function applyJson(): void {
  const result = parseKeymap(jsonText.value, DEFAULT_BINDINGS);
  if (!result.ok) {
    toasts.show({ id: 'keymap-json', tone: 'error', message: result.error });
    return;
  }
  applyOverrides(result.overrides);
  toasts.show({ id: 'keymap-json', tone: 'success', message: t('settings.applied') });
}

function restoreAll(): void {
  resetKeymap();
  jsonText.value = serializeKeymap(bindings.value);
}

const changedCount = computed(() => Object.keys(currentOverrides()).length);
</script>

<template>
  <Sheet
    v-model="open"
    :title="$t('settings.keyboard')"
    icon="keyboard"
    flush
  >
    <template #lead>
      <SegmentedControl
        v-model="view"
        :options="views"
        :aria-label="$t('settings.keyboard')"
      />
    </template>

    <div
      v-show="view === 'visual'"
      class="panels"
    >
      <p class="note">
        {{ $t('settings.keyboardEdit') }}
      </p>

      <div
        v-for="group in groups"
        :key="group"
        class="rows"
      >
        <div class="row row--header">
          <span class="row__label row__label--group">{{ group }}</span>
        </div>

        <div
          v-for="binding in bindingsIn(group)"
          :key="binding.id"
          class="row"
        >
          <span class="row__label">
            {{ binding.label }}
            <span
              v-if="clashes.get(binding.id)"
              class="row__hint row__hint--clash"
            >
              <AppIcon
                name="warning"
                :size="11"
              />
              {{ $t('settings.keyboardClash', { names: clashes.get(binding.id)!.join(', ') }) }}
            </span>
          </span>

          <!--
            The recorder replaces the chord in place rather than opening
            anywhere: the thing being changed is the thing you clicked, and a
            popup over it would put the keystroke somewhere other than where
            the answer appears.
          -->
          <span
            v-if="recording === binding.id"
            class="row__control record"
          >
            <span
              class="record__slot"
              :class="{ 'record__slot--empty': !captured }"
              role="status"
            >{{ captured ? displayKeys(captured) : $t('settings.keyboardPress') }}</span>

            <button
              v-tip="$t('action.cancel')"
              type="button"
              class="record__verb focus-fill"
              :aria-label="$t('action.cancel')"
              @click="stopRecording"
            >
              <AppIcon
                name="close"
                :size="12"
              />
            </button>
            <button
              v-tip="$t('action.save')"
              type="button"
              class="record__verb record__verb--commit focus-fill"
              :aria-label="$t('action.save')"
              :disabled="!captured"
              @click="commit"
            >
              <AppIcon
                name="check"
                :size="12"
              />
            </button>
          </span>

          <span
            v-else
            class="row__control keys"
          >
            <button
              v-tip="$t('settings.keyboardRestore')"
              type="button"
              class="keys__restore focus-fill"
              :aria-label="$t('settings.keyboardRestore')"
              :class="{ 'keys__restore--on': isChanged(binding.id) }"
              :disabled="!isChanged(binding.id)"
              @click="restore(binding.id)"
            >
              <AppIcon
                name="refresh"
                :size="11"
              />
            </button>

            <button
              type="button"
              class="keys__edit focus-fill"
              :aria-label="$t('settings.keyboardRecord', { name: binding.label })"
              @click="startRecording(binding.id)"
            >
              <kbd
                v-for="accelerator in binding.keys"
                :key="accelerator"
              >{{
                displayKeys(accelerator)
              }}</kbd>
              <span
                v-if="binding.keys.length === 0"
                class="keys__none"
              >{{
                $t('settings.keyboardNone')
              }}</span>
            </button>
          </span>
        </div>
      </div>
    </div>

    <div
      v-show="view === 'json'"
      class="json"
    >
      <JsonEditor
        v-model="jsonText"
        class="json__editor"
        :label="$t('settings.viewJson')"
      />

      <div class="json__bar">
        <span
          v-if="jsonError"
          class="json__state json__state--error"
          role="alert"
        >
          <AppIcon
            name="warning"
            :size="13"
          />
          {{ jsonError }}
        </span>
        <span
          v-else
          class="json__state json__state--ok"
        >
          <AppIcon
            name="check"
            :size="13"
          />
          {{ $t('settings.jsonValid') }}
        </span>

        <span class="json__gap" />

        <button
          type="button"
          class="json__action focus-fill"
          :disabled="changedCount === 0"
          @click="restoreAll"
        >
          <AppIcon
            name="refresh"
            :size="12"
          />
          {{ $t('settings.keyboardRestoreAll') }}
        </button>

        <PressButton
          size="sm"
          variant="primary"
          :disabled="!!jsonError"
          @click="applyJson"
        >
          {{ $t('action.apply') }}
        </PressButton>
      </div>
    </div>
  </Sheet>
</template>

<style scoped>
/* The same shape the settings sheet uses; this is the same kind of page. */
.panels {
  display: flex;
  flex-direction: column;
  gap: var(--gap-loose);
  padding: var(--gap-loose) var(--gap-section) var(--gap-section);
  border-top: 1px solid var(--separator);
}

.note {
  max-width: 56ch;
  font-size: 0.75rem;
  line-height: 1.5;
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
}

.rows {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--separator);
  border-radius: var(--radius-box);
  background: var(--fill-4);
  overflow: hidden;
}

.row {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gap);
  min-height: 2.75rem;
  padding: var(--gap-tight) var(--gap-loose);
  font-size: 0.8125rem;
  font-weight: 500;
}

.row + .row::before {
  content: '';
  position: absolute;
  top: 0;
  inset-inline: var(--gap-loose) 0;
  height: 1px;
  background: var(--separator);
}

.row__label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.row__hint {
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 46ch;
  font-size: 0.6875rem;
  font-weight: 400;
  line-height: 1.45;
}

.row__hint--clash {
  color: var(--color-warning);
}

.row__label--group {
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: color-mix(in oklab, var(--color-base-content) 48%, transparent);
}

.row--header {
  min-height: 0;
  padding-block: var(--gap-tight);
  background: color-mix(in oklab, var(--color-base-content) 3%, transparent);
}

.row__control {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  flex: 0 0 auto;
  margin-inline-start: auto;
}

/*
 * The chords are the button. A separate pencil beside them would be a second
 * target for the thing the reader is already pointing at.
 */
.keys__edit {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  min-height: var(--hit-min);
  padding-inline: var(--gap-tight);
  border-radius: var(--radius-field);
  transition: background-color var(--t-hover) var(--ease-out);
}

@media (hover: hover) and (pointer: fine) {
  .keys__edit:hover {
    background: var(--fill-3);
  }
}

.keys kbd {
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--separator-strong);
  background: var(--color-base-100);
  font-family: var(--font-ui);
  font-size: 0.625rem;
}

.keys__none {
  font-size: 0.6875rem;
  font-weight: 400;
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
}

/*
 * Present on every row, and inert on the ones that have not moved.
 *
 * It could appear only where it applies, but then a column of chords grows and
 * loses a control as the reader edits it, and every row after the first change
 * shifts sideways.
 */
.keys__restore {
  display: grid;
  place-items: center;
  width: var(--hit-min);
  height: var(--hit-min);
  border-radius: var(--radius-field);
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
  opacity: 0;
  transition: opacity var(--t-hover) var(--ease-out);
}

.keys__restore--on {
  opacity: 1;
}

.record {
  gap: var(--gap-hair);
}

/*
 * Wide enough for the prompt, so the row does not resize the moment a chord
 * lands in it.
 */
.record__slot {
  display: grid;
  place-items: center;
  min-width: 9rem;
  min-height: var(--hit-min);
  padding-inline: var(--gap);
  border-radius: var(--radius-field);
  border: 1px solid var(--color-primary);
  background: color-mix(in oklab, var(--color-primary) 12%, transparent);
  font-size: 0.75rem;
  font-weight: 600;
}

.record__slot--empty {
  border-style: dashed;
  font-weight: 400;
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
}

.record__verb {
  display: grid;
  place-items: center;
  width: var(--hit-min);
  height: var(--hit-min);
  border-radius: var(--radius-field);
  transition: background-color var(--t-hover) var(--ease-out);
}

@media (hover: hover) and (pointer: fine) {
  .record__verb:hover {
    background: var(--fill-3);
  }
}

.record__verb--commit:not(:disabled) {
  color: var(--color-primary-text);
}

.record__verb:disabled {
  opacity: 0.4;
}

.json {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-top: 1px solid var(--separator);
}

.json__editor {
  height: min(28rem, 52vh);
}

.json__bar {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  min-height: calc(var(--field-h) + var(--gap));
  padding-inline: var(--gap-section);
  padding-block: calc(var(--gap) / 2);
  border-top: 1px solid var(--separator);
  background: var(--fill-4);
  font-size: 0.6875rem;
}

.json__state {
  display: inline-flex;
  align-items: center;
  gap: var(--gap-hair);
}

.json__state--error {
  color: var(--color-error);
}

.json__state--ok {
  color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
}

.json__gap {
  flex: 1;
}

.json__action {
  display: inline-flex;
  align-items: center;
  gap: var(--gap-hair);
  height: var(--field-h);
  padding-inline: var(--gap);
  border-radius: var(--radius-field);
  font-size: 0.6875rem;
  font-weight: 550;
  transition: background-color var(--t-hover) var(--ease-out);
}

.json__action:disabled {
  opacity: 0.4;
}

@media (hover: hover) and (pointer: fine) {
  .json__action:not(:disabled):hover {
    background: var(--fill-3);
  }
}

@media (prefers-reduced-motion: reduce) {
  .keys__edit,
  .keys__restore,
  .record__verb,
  .json__action {
    transition: none;
  }
}
</style>
