<script setup lang="ts">
/**
 * Exporting a result set.
 *
 * One sheet, two decisions: what shape, and where it goes. They were separate
 * menus before — a list of eight download items, half of which differed only in
 * whether they ended up on the clipboard — which made the shape and the
 * destination look like eight unrelated actions instead of two choices.
 *
 * The two are not independent, and the sheet says so rather than hiding it. A
 * file is written by the host, streaming straight to disk without the rows
 * passing through this process, so it can write the *whole* result set however
 * large. The clipboard can only hold what is already loaded.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import type { CellValue, Field } from '@drivers/types';
import { toDelimited, toJson, toMarkdown } from '@shared/tabular';
import { displayValue, isTagged } from '@shared/values';
import { useSettings } from '../../stores/settings';
import AppIcon from '../ui/AppIcon.vue';
import { vTip } from '../../lib/hoverTip';
import { elapsedLabel, useElapsed } from '../../composables/useElapsed';
import { useToasts } from '../../stores/toasts';
import CircuitRing from '../ui/CircuitRing.vue';
import PressButton from '../ui/PressButton.vue';
import SegmentedControl from '../ui/SegmentedControl.vue';
import Sheet from '../ui/Sheet.vue';
import { errorMessage } from '@shared/errors';

const props = defineProps<{
  fields: readonly Field[];
  rows: readonly Record<string, CellValue>[];
  /** Suggested file name, without an extension. */
  name: string;
  /*
   * Absent when there is no query to re-run — the clipboard is then the only
   * destination, because only the host can stream a file.
   *
   * Deliberately not named `onWriteFile`: a prop whose name begins with `on`
   * is read by the template compiler as an event listener, so it never arrives
   * as a prop at all.
   */
  writeFile?: (
    path: string,
    format: 'csv' | 'json' | 'jsonl' | 'sql',
    scope: Scope
  ) => Promise<void>;
  /**
   * How many rows the statement would return without the preview limit.
   *
   * Present only where the two can differ. A run fetches a page so you can look
   * at it, so "export this" is genuinely two requests: the rows on screen, or
   * the ones the statement actually matches — and the second means running it
   * again, which is worth saying out loud rather than doing silently either
   * way. Absent when there is nothing to choose between, as for a dispatched
   * job whose whole answer is already on this machine.
   */
  fullRows?: number;
  /** Files can be a fresh query, a whole table, or an already saved job. */
  fileSource?: 'query' | 'table' | 'job';
  /** True when the loaded rows are only the first page of a larger answer. */
  truncated?: boolean;
}>();

const open = defineModel<boolean>({ required: true });
const toasts = useToasts();
const { t } = useTranslation();

type Delivery = 'file' | 'clipboard';
type Format = 'csv' | 'tsv' | 'json' | 'jsonl' | 'markdown' | 'sql';
export type Scope = 'page' | 'full';

/**
 * Which rows, when the two are not the same set.
 *
 * The page is what is loaded — instant, and exactly what you were looking at.
 * The full set means the statement runs again without the preview limit, which
 * is the honest cost of asking for rows nobody has fetched yet. Offered only
 * where a limit was actually applied; otherwise the question does not arise and
 * the control is not there to be answered wrongly.
 */
const scope = ref<Scope>('page');

const delivery = ref<Delivery>(props.writeFile ? 'file' : 'clipboard');
const format = ref<Format>('csv');
const busy = ref(false);
const elapsed = useElapsed(busy);
const done = ref<string | null>(null);
const error = ref<string | null>(null);

/** Only the host can stream a file, and only in the shapes it knows how to write. */
const FILE_FORMATS: readonly Format[] = ['csv', 'json', 'jsonl', 'sql'];
const CLIPBOARD_FORMATS: readonly Format[] = ['csv', 'tsv', 'json', 'markdown'];

const deliveries = computed(() => [
  { value: 'file' as const, label: t('export.toFile') },
  { value: 'clipboard' as const, label: t('export.toClipboard') },
]);

const available = computed(() =>
  delivery.value === 'file' ? FILE_FORMATS : CLIPBOARD_FORMATS
);

const LABELS: Record<Format, string> = {
  csv: 'CSV',
  tsv: 'TSV',
  json: 'JSON',
  jsonl: 'JSON Lines',
  markdown: 'Markdown',
  sql: 'SQL',
};

const formats = computed(() =>
  available.value.map((option) => ({ value: option, label: LABELS[option] }))
);

// Switching destination can strip the chosen shape out from under it.
watch([delivery, available], () => {
  if (!available.value.includes(format.value)) format.value = available.value[0]!;
});

const canWriteFile = computed(() => props.writeFile !== undefined);
const settings = useSettings();
const preview = ref<HTMLElement>();
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const stopReveal = () =>
  preview.value?.getAnimations().forEach((animation) => animation.cancel());
motionPreference.addEventListener('change', stopReveal);
onBeforeUnmount(() => motionPreference.removeEventListener('change', stopReveal));
const sampleFields = computed(() => props.fields.slice(0, 4));
const sampleRows = computed(() => props.rows.slice(0, 5));
const rowSummary = computed(() =>
  delivery.value === 'file' &&
  (scope.value === 'full' || props.fileSource === 'table' || props.fileSource === 'job')
    ? props.fullRows === undefined
      ? t('export.allMatching')
      : t('export.rowCount', { count: props.fullRows })
    : t('export.rowCount', { count: props.rows.length })
);

/** A preview must stay cheap even when a loaded cell is a very large blob. */
function cell(row: Record<string, CellValue>, field: Field): string {
  const value = row[field.name] ?? null;
  if (value === null) return 'NULL';
  const shortened = isTagged(value) && value.$ === 'binary' && value.data.length > 160;
  const text = displayValue(shortened ? { ...value, data: value.data.slice(0, 160) } : value, {
    encoding: settings.values.binaryEncoding,
    ...(field.dataType ? { dataType: field.dataType } : {}),
  });
  return text.length > 160 || shortened ? `${text.slice(0, 160)}…` : text;
}

/** Keep the export's output stable while the asynchronous writer is running. */
watch(
  () => props.writeFile,
  (writer) => {
    if (!writer && !busy.value) delivery.value = 'clipboard';
  }
);
watch(open, (visible) => {
  if (!visible || busy.value) return;
  error.value = null;
  done.value = null;
  if (!canWriteFile.value) delivery.value = 'clipboard';
});

async function acknowledge(event: MouseEvent | KeyboardEvent): Promise<void> {
  preview.value?.getAnimations().forEach((animation) => animation.cancel());
  await nextTick();
  if (!(event instanceof MouseEvent) || event.detail === 0 || !preview.value) return;
  preview.value.animate([{ opacity: 0.65 }, { opacity: 1 }], {
    duration: 180,
    easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
  });
}

function chooseDelivery(next: Delivery, event: MouseEvent | KeyboardEvent): void {
  if (busy.value || (next === 'file' && !canWriteFile.value) || next === delivery.value) return;
  delivery.value = next;
  done.value = null;
  void acknowledge(event);
}

function chooseFormat(next: Format, event: MouseEvent | KeyboardEvent): void {
  if (busy.value || next === format.value) return;
  format.value = next;
  done.value = null;
  void acknowledge(event);
}

/** Radio cards support the same Arrow/Home/End interaction as segmented choices. */
function choiceKey(event: KeyboardEvent, kind: 'delivery' | 'format'): void {
  const choices =
    kind === 'delivery'
      ? deliveries.value
          .filter((choice) => choice.value !== 'file' || canWriteFile.value)
          .map((choice) => choice.value)
      : available.value;
  const current = kind === 'delivery' ? delivery.value : format.value;
  const index = (choices as readonly string[]).indexOf(current);
  const delta =
    event.key === 'ArrowRight' || event.key === 'ArrowDown'
      ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? -1
        : 0;
  if (!delta && event.key !== 'Home' && event.key !== 'End') return;
  event.preventDefault();
  const next =
    choices[
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? choices.length - 1
          : (index + delta + choices.length) % choices.length
    ];
  if (!next) return;
  if (kind === 'delivery') chooseDelivery(next as Delivery, event);
  else chooseFormat(next as Format, event);
  (event.currentTarget as HTMLElement).parentElement
    ?.querySelector<HTMLElement>(`[data-choice="${next}"]`)
    ?.focus();
}

/*
 * The choice exists whenever the rows on screen are only the first of them.
 *
 * It used to also require knowing how many there were in total, which was a
 * number the app had because the whole result came back and was cut here. Now
 * the limit is in the statement, so "how many are there really" is a question
 * nobody has asked the server — and having no answer to it is not a reason to
 * stop offering the export that would go and find out.
 */
const offersScope = computed(
  () =>
    (!props.fileSource || props.fileSource === 'query') &&
    props.truncated === true &&
    (props.fullRows === undefined || props.fullRows > props.rows.length)
);

const fileHint = computed(() =>
  props.fileSource === 'table'
    ? t('export.tableFileHint')
    : props.fileSource === 'job'
      ? t('export.jobFileHint')
      : scope.value === 'full'
        ? t('export.scopeFullHintUnknown')
        : t('export.scopePageHint')
);

const scopes = computed(() => [
  { value: 'page' as const, label: t('export.scopePage', { count: props.rows.length }) },
  { value: 'full' as const, label: t('export.scopeFull') },
]);

// The clipboard can only hold what is already in this process, so asking it for
// the full set is asking for something it cannot do.
watch([delivery, offersScope], () => {
  if (delivery.value === 'clipboard' || !offersScope.value) scope.value = 'page';
});

function render(): string {
  switch (format.value) {
    case 'tsv':
      return toDelimited(props.fields, props.rows, '\t');
    case 'json':
      return toJson(props.fields, props.rows);
    case 'markdown':
      return toMarkdown(props.fields, props.rows);
    default:
      return toDelimited(props.fields, props.rows, ',');
  }
}

async function run(): Promise<void> {
  busy.value = true;
  error.value = null;
  done.value = null;

  try {
    if (delivery.value === 'clipboard') {
      await navigator.clipboard.writeText(render());
      done.value = t('export.copied', { count: props.rows.length });
      return;
    }

    const extension = format.value === 'jsonl' ? 'jsonl' : format.value;
    const path = await window.shelf.dialogs.saveFile({
      title: t('export.title'),
      defaultPath: `${props.name}.${extension}`,
      extensions: [extension],
    });
    if (!path) return;

    await props.writeFile!(path, format.value as 'csv' | 'json' | 'jsonl' | 'sql', scope.value);
    /*
     * The confirmation goes to a toast because the sheet holding it closes in
     * the next statement. It set `done` and then dismissed the surface the
     * message was written on, so a successful export said nothing at all.
     */
    open.value = false;
    toasts.show({
      tone: 'success',
      message: t('export.wroteTo', { name: path.split(/[\\/]/).pop() ?? path }),
    });
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Sheet v-model="open" :title="$t('export.title')" icon="download" broad flush>
    <div class="export-layout" :aria-busy="busy">
      <fieldset class="export-options" :disabled="busy">
        <section class="export-section">
          <h3 class="export-section__title">{{ $t('export.delivery') }}</h3>
          <div class="delivery-choices" role="radiogroup" :aria-label="$t('export.delivery')">
            <button
              v-for="option in deliveries"
              :key="option.value"
              class="delivery-choice focus-fill"
              role="radio"
              :aria-label="option.label"
              :aria-checked="delivery === option.value"
              :tabindex="delivery === option.value ? 0 : -1"
              :disabled="option.value === 'file' && !canWriteFile"
              :data-choice="option.value"
              @click="chooseDelivery(option.value, $event)"
              @keydown="choiceKey($event, 'delivery')"
            >
              <AppIcon :name="option.value === 'file' ? 'folder' : 'copy'" :size="20" />
              <span class="delivery-choice__name">{{ option.label }}</span>
              <AppIcon
                v-if="delivery === option.value"
                class="choice-check"
                name="check"
                :size="13"
              />
            </button>
          </div>
          <p class="export-hint">
            {{
              delivery === 'file'
                ? fileHint
                : $t('export.clipboardHint', { count: rows.length })
            }}
          </p>
          <p v-if="!canWriteFile" class="export-hint">{{ $t('export.fileUnavailable') }}</p>
        </section>

        <section class="export-section">
          <h3 class="export-section__title">{{ $t('export.format') }}</h3>
          <div class="format-choices" role="radiogroup" :aria-label="$t('export.format')">
            <button
              v-for="option in formats"
              :key="option.value"
              class="format-choice focus-fill"
              role="radio"
              :aria-label="option.label"
              :aria-checked="format === option.value"
              :tabindex="format === option.value ? 0 : -1"
              :data-choice="option.value"
              @click="chooseFormat(option.value, $event)"
              @keydown="choiceKey($event, 'format')"
            >
              <span class="format-choice__name">{{ option.label }}</span>
              <span class="format-choice__desc">{{
                $t(`export.formatHint${option.value[0]!.toUpperCase()}${option.value.slice(1)}`)
              }}</span>
              <AppIcon
                v-if="format === option.value"
                class="choice-check"
                name="check"
                :size="13"
              />
            </button>
          </div>
        </section>

        <section v-if="offersScope && delivery === 'file'" class="export-section">
          <h3 class="export-section__title">{{ $t('export.scope') }}</h3>
          <SegmentedControl v-model="scope" :options="scopes" :ariaLabel="$t('export.scope')" />
          <p class="export-hint">
            {{
              scope !== 'full'
                ? $t('export.scopePageHint')
                : fullRows === undefined
                  ? $t('export.scopeFullHintUnknown')
                  : $t('export.scopeFullHint', { count: fullRows })
            }}
          </p>
        </section>
      </fieldset>

      <aside ref="preview" class="export-preview" :aria-label="$t('export.summary')">
        <div class="export-document">
          <span class="export-document__icon"
            ><AppIcon :name="delivery === 'file' ? 'download' : 'copy'" :size="24"
          /></span>
          <div class="export-document__text">
            <p class="export-document__eyebrow">{{ $t('export.summary') }}</p>
            <p
              :key="`${delivery}-${format}`"
              v-tip="delivery === 'file' ? `${name}.${format}` : $t('export.toClipboard')"
              class="export-document__name"
            >
              {{ delivery === 'file' ? `${name}.${format}` : $t('export.toClipboard') }}
            </p>
          </div>
        </div>
        <dl class="export-facts">
          <div>
            <dt>{{ $t('export.scope') }}</dt>
            <dd>{{ rowSummary }}</dd>
          </div>
          <div v-if="fields.length">
            <dt>{{ $t('export.columns') }}</dt>
            <dd>{{ fields.length }}</dd>
          </div>
          <div>
            <dt>{{ $t('export.format') }}</dt>
            <dd>{{ LABELS[format] }}</dd>
          </div>
        </dl>
        <div v-if="sampleRows.length && sampleFields.length" class="export-sample">
          <div class="export-sample__scroll">
            <table class="export-sample__table">
              <thead>
                <tr>
                  <th v-for="field in sampleFields" :key="field.name" scope="col">
                    {{ field.name }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in sampleRows" :key="index">
                  <td v-for="field in sampleFields" :key="field.name">
                    {{ cell(row, field) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="export-sample__caption">
            {{ $t('export.sample', { rows: sampleRows.length, columns: sampleFields.length }) }}
          </p>
        </div>
        <p v-else class="export-preview__empty">
          <AppIcon name="database" :size="24" />{{ $t('export.noPreview') }}
        </p>
        <p class="export-hint">
          {{
            delivery === 'clipboard'
              ? $t('export.clipboardHint', { count: rows.length })
              : $t('export.previewHint')
          }}
        </p>
      </aside>
    </div>
    <div
      v-if="error || done"
      class="export-feedback"
      :class="{ 'export-feedback--error': error }"
      :role="error ? 'alert' : 'status'"
    >
      <AppIcon :name="error ? 'warning' : 'check'" :size="16" />{{ error || done }}
    </div>
    <template #footer>
      <PressButton size="sm" @click="open = false">{{ $t('action.cancel') }}</PressButton>
      <PressButton
        class="export__go"
        size="sm"
        variant="primary"
        :disabled="busy || (delivery === 'file' && !canWriteFile)"
        @click="run"
      >
        <CircuitRing v-if="busy" />
        <AppIcon v-else :name="delivery === 'file' ? 'download' : 'copy'" :size="13" />
        <span :class="{ export__label: busy }">{{
          busy ? $t('export.working') : $t('export.run')
        }}</span>
        <span v-if="busy" class="export__clock" role="timer">{{ elapsedLabel(elapsed) }}</span>
      </PressButton>
    </template>
  </Sheet>
</template>

<style scoped>
.export-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  border-top: 1px solid var(--separator);
}
.export-options {
  min-width: 0;
  margin: 0;
  padding: var(--gap-section);
  border: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
}
.export-section {
  display: flex;
  flex-direction: column;
  gap: var(--gap);
}
.export-section__title {
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.delivery-choices,
.format-choices {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gap);
}
.delivery-choice,
.format-choice {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: start;
  gap: var(--gap-tight);
  min-width: 0;
  padding: var(--gap-loose);
  border: 1px solid var(--separator);
  border-radius: var(--radius-card);
  background: var(--fill-4);
  min-height: var(--hit-min);
  transition:
    background-color var(--t-hover) var(--ease-out),
    border-color var(--t-hover) var(--ease-out),
    transform var(--t-press) var(--ease-out);
}
.delivery-choice > .icon {
  color: var(--text-soft);
}
.delivery-choice[aria-checked='true'],
.format-choice[aria-checked='true'] {
  border-color: var(--color-primary-text);
  background: var(--accent-subtle);
}
.delivery-choice[aria-checked='true'] > .icon {
  color: var(--color-primary-text);
}
.delivery-choice__name,
.format-choice__name {
  font-size: 0.8125rem;
  font-weight: 600;
  padding-inline-end: 1rem;
}
.format-choice__desc {
  font-size: 0.6875rem;
  color: var(--text-soft);
  line-height: 1.4;
}
.choice-check {
  position: absolute;
  top: var(--gap);
  inset-inline-end: var(--gap);
  color: var(--color-primary-text);
}
.delivery-choice:disabled,
.export-options:disabled .format-choice {
  opacity: 0.5;
  cursor: default;
}
.delivery-choice:active:not(:disabled),
.format-choice:active:not(:disabled) {
  transform: scale(0.98);
}
.export-hint {
  font-size: 0.6875rem;
  line-height: 1.5;
  color: var(--text-soft);
}
.export-preview {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-loose);
  padding: var(--gap-section);
  background: var(--fill-4);
  border-inline-start: 1px solid var(--separator);
}
.export-document {
  display: flex;
  align-items: center;
  gap: var(--gap);
  min-width: 0;
}
.export-document__icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 3rem;
  height: 3rem;
  background: var(--fill-3);
  border-radius: var(--radius-card);
  color: var(--color-primary-text);
}
.export-document__text {
  min-width: 0;
}
.export-document__eyebrow {
  font-size: 0.6875rem;
  color: var(--text-soft);
}
.export-document__name {
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: -0.012em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.export-facts {
  display: flex;
  flex-direction: column;
  gap: var(--gap);
  font-size: 0.75rem;
}
.export-facts > div {
  display: flex;
  justify-content: space-between;
  gap: var(--gap);
}
.export-facts dt {
  color: var(--text-soft);
}
.export-facts dd {
  text-align: end;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.export-sample {
  min-width: 0;
  overflow: hidden;
  border-radius: var(--radius-card);
  border: 1px solid var(--separator);
  background: var(--surface-well);
}
.export-sample__scroll {
  overflow: auto;
  max-height: 12rem;
}
.export-sample__table {
  display: table;
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 0.6875rem;
}
.export-sample__table th,
.export-sample__table td {
  text-align: start;
  padding: var(--gap-tight) var(--gap);
  max-width: 10rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-bottom: 1px solid var(--separator);
}
.export-sample__table th {
  font-weight: 500;
  color: var(--text-soft);
  background: var(--fill-3);
}
.export-sample__table tr:last-child td {
  border-bottom: 0;
}
.export-sample__caption {
  padding: var(--gap);
  color: var(--text-soft);
  font-size: 0.625rem;
  border-top: 1px solid var(--separator);
}
.export-preview__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: var(--gap);
  min-height: 9rem;
  color: var(--text-soft);
  font-size: 0.75rem;
  border: 1px dashed var(--separator-strong);
  border-radius: var(--radius-card);
  padding: var(--gap-loose);
}
.export-feedback {
  display: flex;
  align-items: center;
  gap: var(--gap);
  padding: var(--gap) var(--gap-section);
  color: var(--color-success);
  font-size: 0.75rem;
  background: var(--fill-4);
  border-top: 1px solid var(--separator);
}
.export-feedback--error {
  color: var(--color-error);
}
.export__go {
  position: relative;
}
.export__clock {
  min-width: 4.25rem;
  text-align: end;
  font-variant-numeric: tabular-nums;
}
.export__label {
  opacity: 0.85;
}
@media (hover: hover) and (pointer: fine) {
  .delivery-choice:hover:not(:disabled),
  .format-choice:hover:not(:disabled) {
    background: var(--fill-3);
  }
}
@media (prefers-reduced-motion: reduce) {
  .delivery-choice:active:not(:disabled),
  .format-choice:active:not(:disabled) {
    transform: none;
  }
}
@media (max-width: 650px) {
  .export-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .export-preview {
    border-inline-start: 0;
    border-top: 1px solid var(--separator);
  }
}
</style>
