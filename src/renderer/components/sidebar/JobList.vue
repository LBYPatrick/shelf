<script setup lang="ts">
/**
 * Dispatched queries, newest first.
 *
 * A list rather than a tab per job: most of them are finished and will never be
 * opened again, and a workspace that grows a tab for every dispatch is a
 * workspace you have to tidy. Opening one is a deliberate act, and it opens
 * where every other result opens.
 *
 * The name is editable in place. It starts as the database and the moment,
 * which is the only default that is never wrong, and becomes whatever the
 * reader calls the thing they were actually asking — "june refunds" beats
 * "production-20260819-090405" the moment there are three of them.
 */
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useJobs, type Job } from '../../stores/jobs';
import { useTabs } from '../../stores/tabs';
import { useToasts } from '../../stores/toasts';
import AppIcon from '../ui/AppIcon.vue';
import StatusChip from '../ui/StatusChip.vue';

const jobs = useJobs();
const tabs = useTabs();
const toasts = useToasts();
const { t } = useTranslation();

const editing = ref<string | null>(null);
const draft = ref('');
const field = ref<HTMLInputElement>();

/** The four states, named. Flat keys, because the bundles are two levels deep. */
function statusLabel(status: Job['status']): string {
  return t(`jobs.status${status[0]!.toUpperCase()}${status.slice(1)}`);
}

function open(job: Job): void {
  if (job.status !== 'done' || !job.path) return;
  tabs.openJob(job.id, job.name);
}

async function beginRename(job: Job): Promise<void> {
  editing.value = job.id;
  draft.value = job.name;
  await nextTick();
  field.value?.select();
}

function commitRename(): void {
  if (editing.value) jobs.rename(editing.value, draft.value);
  editing.value = null;
}

async function discard(job: Job): Promise<void> {
  tabs.closeJob(job.id);
  await jobs.remove(job.id);
  toasts.show({ tone: 'info', message: t('jobs.discarded', { name: job.name }) });
}

/**
 * Twice a second, and only while this list is on screen.
 *
 * A job runs for minutes, is read at a glance, and is one of a list of them —
 * so the readout carries tenths rather than the query bar's hundredths, and the
 * tick matches: a clock updated more often than its last digit can change is
 * work done to redraw the same string. The list is mounted only while the rail
 * is showing it, so "on screen" needs no further asking.
 */
const TICK_MS = 500;

/**
 * The clock a running job is read by.
 *
 * `Date.now()` inside the template is not a reason for Vue to draw again, so
 * the number was whatever the clock said the last time something *else* changed
 * — a job that ran for a minute showed the tenth of a second it had reached
 * when the list was last touched, and looked stopped. The tick is the reactive
 * thing, and it only runs while there is something to count.
 */
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | undefined;

/*
 * `status`, which is what the field is called. Keyed on a `state` that no job
 * has, this was always false: the ticker never started, and the clock showed
 * whatever it had said when something else last redrew the list.
 */
const counting = computed(() => jobs.running.length > 0);

watch(
  counting,
  (active) => {
    if (ticker !== undefined) clearInterval(ticker);
    ticker = undefined;
    if (!active) return;

    now.value = Date.now();
    ticker = setInterval(() => (now.value = Date.now()), TICK_MS);
  },
  { immediate: true }
);

onScopeDispose(() => {
  if (ticker !== undefined) clearInterval(ticker);
});

/** How long it took, or how long it has been going. */
function duration(job: Job): string {
  const seconds = Math.max(0, (job.finishedAt ?? now.value) - job.startedAt) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;

  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
</script>

<template>
  <div class="joblist">
    <p
      v-if="jobs.ordered.length === 0"
      class="joblist__empty"
    >
      {{ $t('jobs.empty') }}
    </p>

    <div
      v-for="job in jobs.ordered"
      :key="job.id"
      class="job"
    >
      <button
        type="button"
        class="job__face focus-fill"
        :disabled="job.status !== 'done'"
        :aria-label="t('jobs.openResult', { name: job.name })"
        @click="open(job)"
      >
        <span class="job__top">
          <input
            v-if="editing === job.id"
            ref="field"
            v-model="draft"
            class="job__rename"
            :aria-label="$t('jobs.rename')"
            @click.stop
            @keydown.enter.prevent="commitRename"
            @keydown.esc.prevent="editing = null"
            @blur="commitRename"
          >
          <span
            v-else
            class="job__name"
          >{{ job.name }}</span>

          <StatusChip
            :tone="job.status"
            :label="statusLabel(job.status)"
          />
        </span>

        <span class="job__meta">
          <span v-if="job.status === 'done'">{{
            $t('jobs.rowsIn', { rows: job.rows.toLocaleString(), time: duration(job) })
          }}</span>
          <span
            v-else-if="job.status === 'failed'"
            class="job__error"
          >{{ job.error }}</span>
          <span v-else>{{ duration(job) }}</span>
        </span>
      </button>

      <span class="job__tools">
        <button
          v-tip="$t('jobs.rename')"
          type="button"
          class="job__tool focus-fill"
          :aria-label="$t('jobs.rename')"
          @click="beginRename(job)"
        >
          <AppIcon
            name="pencil"
            :size="12"
          />
        </button>
        <button
          v-tip="$t('jobs.discard')"
          type="button"
          class="job__tool focus-fill"
          :aria-label="$t('jobs.discard')"
          @click="discard(job)"
        >
          <AppIcon
            name="close"
            :size="12"
          />
        </button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.joblist {
  display: flex;
  flex-direction: column;
  padding: var(--gap-tight);
  gap: 2px;
  overflow-y: auto;
}

.joblist__empty {
  padding: var(--gap-section) var(--gap-loose);
  font-size: 0.75rem;
  line-height: 1.5;
  text-align: center;
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
}

.job {
  position: relative;
  display: flex;
  align-items: center;
  border-radius: var(--radius-field);
}

@media (hover: hover) and (pointer: fine) {
  .job:hover {
    background: var(--fill-4);
  }
}

.job__face {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: var(--gap-tight) var(--gap);
  border-radius: var(--radius-field);
  text-align: start;
}

/* A job with no rows to show is not a link; it still says what happened. */
.job__face:disabled {
  cursor: default;
}

.job__top {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  min-width: 0;
}

.job__name,
.job__rename {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
  font-weight: 500;
}

.job__rename {
  border-radius: 4px;
  background: var(--color-base-100);
  box-shadow: inset 0 0 0 1px var(--color-primary);
  padding-inline: 4px;
  color: inherit;
}

.job__meta {
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.job__error {
  color: var(--color-error);
}

/*
 * The tools appear on approach. They are destructive-adjacent and read on every
 * row of a long list otherwise — but they are always in the box model, so the
 * name never re-wraps when the pointer arrives.
 */
.job__tools {
  display: flex;
  flex: 0 0 auto;
  gap: 2px;
  padding-inline-end: var(--gap-tight);
  opacity: 0;
  transition: opacity var(--t-hover) var(--ease-out);
}

.job:hover .job__tools,
.job:focus-within .job__tools {
  opacity: 1;
}

.job__tool {
  display: grid;
  place-items: center;
  width: var(--hit-min);
  height: var(--hit-min);
  border-radius: var(--radius-field);
  color: color-mix(in oklab, var(--color-base-content) 60%, transparent);
}

@media (hover: hover) and (pointer: fine) {
  .job__tool:hover {
    background: var(--fill-3);
    color: var(--color-base-content);
  }
}

@media (prefers-reduced-motion: reduce) {
  .job__tools {
    transition: none;
  }
}
</style>
