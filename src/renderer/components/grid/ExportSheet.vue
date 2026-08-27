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

const delivery = ref<Delivery>('file');
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
    props.truncated === true &&
    (props.fullRows === undefined || props.fullRows > props.rows.length)
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
      extensions: [...FILE_FORMATS],
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
  <Sheet v-model="open" :title="$t('export.title')">
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

    <!--
      Only where the answer differs from what is on screen. A run applied a
      preview limit; a dispatched job did not, and its rows are already here.
    -->
    <section v-if="offersScope && delivery === 'file'" class="section">
      <p class="type-label section__title">
        {{ $t('export.scope') }}
      </p>
      <SegmentedControl v-model="scope" :options="scopes" :aria-label="$t('export.scope')" />
      <p class="hint type-label">
        {{
          scope !== 'full'
            ? $t('export.scopePageHint')
            : fullRows === undefined
              ? $t('export.scopeFullHintUnknown')
              : $t('export.scopeFullHint', { count: fullRows })
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
      <SegmentedControl v-model="format" :options="formats" :aria-label="$t('export.format')" />
    </section>

    <p v-if="delivery === 'file' && !canWriteFile" class="hint type-label">
      {{ $t('export.fileUnavailable') }}
    </p>

    <p v-if="error" class="hint hint--error type-label" role="alert">
      {{ error }}
    </p>
    <p v-else-if="done" class="hint type-label" role="status">
      {{ done }}
    </p>

    <template #footer>
      <PressButton size="sm" @click="open = false">
        {{ $t('action.cancel') }}
      </PressButton>
      <!--
        While it is out, the button says how long for and its own edge carries
        the ring. An export of everything a statement matches is the one thing
        in this app with no upper bound on how long it can take, and the sheet
        stays open in front of it — so the reader is left looking at a word.
      -->
      <PressButton
        class="export__go"
        size="sm"
        variant="primary"
        :disabled="busy || (delivery === 'file' && !canWriteFile)"
        @click="run"
      >
        <CircuitRing v-if="busy" />
        <span :class="{ export__label: busy }">
          {{ busy ? $t('export.working') : $t('export.run') }}
        </span>
        <span v-if="busy" class="export__clock" role="timer">{{ elapsedLabel(elapsed) }}</span>
      </PressButton>
    </template>
  </Sheet>
</template>

<style scoped>
/* The ring is drawn on this button's outline, so the button is what it is
   positioned against. */
.export__go {
  position: relative;
}

/*
 * Sized for its widest reading and set in tabular figures, so the hundredths
 * turning over move neither the button's width nor the word beside them.
 */
.export__clock {
  min-width: 4.25rem;
  text-align: end;
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum';
}

.export__label {
  opacity: 0.85;
}

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
