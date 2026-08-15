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
import { computed, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import type { CellValue, Field } from '@drivers/types';
import { toDelimited, toJson, toMarkdown } from '@shared/tabular';
import { useToasts } from '../../stores/toasts';
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
  writeFile?: (path: string, format: 'csv' | 'json' | 'jsonl' | 'sql') => Promise<void>;
}>();

const open = defineModel<boolean>({ required: true });
const toasts = useToasts();
const { t } = useTranslation();

type Delivery = 'file' | 'clipboard';
type Format = 'csv' | 'tsv' | 'json' | 'jsonl' | 'markdown' | 'sql';

const delivery = ref<Delivery>('file');
const format = ref<Format>('csv');
const busy = ref(false);
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
      extensions: [...FILE_FORMATS],
    });
    if (!path) return;

    await props.writeFile!(path, format.value as 'csv' | 'json' | 'jsonl' | 'sql');
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
  <Sheet
    v-model="open"
    :title="$t('export.title')"
  >
    <section class="section">
      <p class="type-label section__title">
        {{ $t('export.delivery') }}
      </p>
      <SegmentedControl
        v-model="delivery"
        :options="deliveries"
        :aria-label="$t('export.delivery')"
      />
      <p class="hint type-label">
        {{
          delivery === 'file'
            ? $t('export.fileHint')
            : $t('export.clipboardHint', { count: rows.length })
        }}
      </p>
    </section>

    <section class="section">
      <p class="type-label section__title">
        {{ $t('export.format') }}
      </p>
      <!--
        The same control the destination uses. These are two questions of the
        same kind — pick one of four — and answering them through two different
        shapes, one above the other, made them look unrelated.
      -->
      <SegmentedControl
        v-model="format"
        :options="formats"
        :aria-label="$t('export.format')"
      />
    </section>

    <p
      v-if="delivery === 'file' && !canWriteFile"
      class="hint type-label"
    >
      {{ $t('export.fileUnavailable') }}
    </p>

    <p
      v-if="error"
      class="hint hint--error type-label"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-else-if="done"
      class="hint type-label"
      role="status"
    >
      {{ done }}
    </p>

    <template #footer>
      <PressButton
        size="sm"
        @click="open = false"
      >
        {{ $t('action.cancel') }}
      </PressButton>
      <PressButton
        size="sm"
        variant="primary"
        :disabled="busy || (delivery === 'file' && !canWriteFile)"
        @click="run"
      >
        {{ busy ? $t('export.working') : $t('export.run') }}
      </PressButton>
    </template>
  </Sheet>
</template>

<style scoped>
.section {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
  padding-block: var(--gap);
}

.section__title {
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
  text-transform: uppercase;
}

.hint {
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
}

.hint--error {
  color: var(--color-error);
}
</style>
