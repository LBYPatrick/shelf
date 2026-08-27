<script setup lang="ts">
/**
 * A dispatched job's rows.
 *
 * The whole answer is already on disk, so this pages through a file rather than
 * through a database: turning a page costs a read, not a query, and it cannot
 * come back different from the page before it. That is also what makes the
 * export instant — it copies the spool, and the statement is never run twice.
 */
import { computed, ref, watch } from 'vue';
import type { CellValue, Field, Row } from '@drivers/types';
import { errorMessage } from '@shared/errors';
import { exportName as buildExportName } from '@shared/fileNames';
import { useTranslation } from 'i18next-vue';
import { host } from '../../lib/host';
import { useJobs } from '../../stores/jobs';
import { useSettings } from '../../stores/settings';
import DataGrid from '../grid/DataGrid.vue';
import ExportSheet from '../grid/ExportSheet.vue';
import RowIndexToggle from '../grid/RowIndexToggle.vue';
import GridSkeleton from '../ui/GridSkeleton.vue';
import PressButton from '../ui/PressButton.vue';
import AppIcon from '../ui/AppIcon.vue';

const props = defineProps<{ jobId: string; active: boolean }>();

const { t } = useTranslation();
const jobs = useJobs();
const settings = useSettings();

const job = computed(() => jobs.find(props.jobId) ?? null);

const offset = ref(0);
const fields = ref<readonly Field[]>([]);
const rows = ref<readonly Row[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

/** The page size is the reader's own preference, the same one the grid pages by. */
const pageSize = computed(() => settings.values.pageSize);

const total = computed(() => job.value?.rows ?? 0);
const lastOffset = computed(() =>
  Math.max(0, Math.floor(Math.max(0, total.value - 1) / pageSize.value) * pageSize.value)
);

async function load(): Promise<void> {
  const path = job.value?.path;
  if (!path) return;

  loading.value = true;
  error.value = null;

  try {
    const page = await host.call('job/page', {
      path,
      offset: offset.value,
      limit: pageSize.value,
    });
    /*
     * The spool describes itself, and the job remembers the same list — so a
     * file written before the spool learned to wait for its cursor's columns
     * still opens with columns. The store's copy was never wrong: it was read
     * after the last batch, when the cursor certainly knew.
     */
    fields.value = page.fields.length > 0 ? page.fields : (job.value?.fields ?? []);
    rows.value = page.rows;
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.jobId, offset.value, pageSize.value],
  () => void load(),
  { immediate: true }
);

function step(by: number): void {
  offset.value = Math.min(lastOffset.value, Math.max(0, offset.value + by * pageSize.value));
}

/* --------------------------------------------------------------------- export */

const exporting = ref(false);
const exportName = ref('');

watch(exporting, (open) => {
  if (open) {
    exportName.value = buildExportName(job.value?.name, 'job', new Date(), Math.random());
  }
});

/**
 * Writing the file is a copy of the spool.
 *
 * No `scope` choice here, unlike a run: there is no "current page versus the
 * whole thing" to decide, because the whole thing is already on this machine
 * and writing it costs the same as writing the page would.
 */
async function writeResultsToFile(
  path: string,
  format: 'csv' | 'json' | 'jsonl' | 'sql'
): Promise<void> {
  const spool = job.value?.path;
  if (!spool) throw new Error(t('jobs.rowsGone'));
  await host.call('job/export', { path: spool, target: path, format });
}
</script>

<template>
  <div class="jobtab">
    <div class="toolbar jobtab__bar" role="toolbar" :aria-label="$t('jobs.resultBar')">
      <div class="toolbar__group" role="group" :aria-label="$t('query.groupResult')">
        <span class="jobtab__summary">{{
          $t('jobs.showing', {
            from: total === 0 ? 0 : offset + 1,
            to: Math.min(total, offset + rows.length),
            total: total.toLocaleString(),
          })
        }}</span>
      </div>

      <span class="toolbar__spacer" />

      <button
        v-tip="$t('jobs.previous')"
        type="button"
        class="toolbar__action toolbar__action--icon focus-fill"
        :disabled="offset === 0 || loading"
        :aria-label="$t('jobs.previous')"
        @click="step(-1)"
      >
        <AppIcon name="chevron" class="jobtab__back" :size="12" />
      </button>
      <button
        v-tip="$t('jobs.next')"
        type="button"
        class="toolbar__action toolbar__action--icon focus-fill"
        :disabled="offset >= lastOffset || loading"
        :aria-label="$t('jobs.next')"
        @click="step(1)"
      >
        <AppIcon name="chevron" :size="12" />
      </button>

      <RowIndexToggle />

      <PressButton size="sm" :disabled="!job?.path" @click="exporting = true">
        <AppIcon name="download" :size="12" />
        {{ $t('action.export') }}
      </PressButton>
    </div>

    <p v-if="error" class="jobtab__error" role="alert">
      {{ error }}
    </p>

    <GridSkeleton v-else-if="loading && rows.length === 0" />

    <DataGrid v-else :fields="fields" :rows="rows" :loading="loading" />

    <ExportSheet
      v-model="exporting"
      :fields="fields"
      :rows="rows as readonly Record<string, CellValue>[]"
      :name="exportName"
      :write-file="writeResultsToFile"
      :full-rows="total"
    />
  </div>
</template>

<style scoped>
.jobtab {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.jobtab__bar {
  flex: 0 0 auto;
  border-bottom: 1px solid var(--separator);
}

.jobtab__summary {
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  color: color-mix(in oklab, var(--color-base-content) 58%, transparent);
}

/* One chevron glyph, pointed both ways: two icons for one idea is two things
   to keep in step. */
.jobtab__back {
  transform: rotate(180deg);
}

.jobtab__error {
  padding: var(--gap) var(--gap-loose);
  margin: var(--gap);
  border-radius: var(--radius-field);
  background: color-mix(in oklab, var(--color-error) 15%, transparent);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  white-space: pre-wrap;
}
</style>
