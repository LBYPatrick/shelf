<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useJobs } from '../../stores/jobs';
import { vTip } from '../../lib/hoverTip';
import AppIcon from '../ui/AppIcon.vue';

defineEmits<{ select: [] }>();
const jobs = useJobs();
const { t } = useTranslation();
const count = computed(() => jobs.running.length);
const completion = ref<'done' | 'failed' | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let batchFailed = false;
watch(
  () => jobs.jobs.map((job) => ({ id: job.id, status: job.status })),
  (current, previous) => {
    const active = (status: string) => status === 'pending' || status === 'running';
    const ended = current.filter(
      (job) =>
        previous.some((old) => old.id === job.id && active(old.status)) && !active(job.status)
    );
    if (count.value > 0) {
      if (!previous.some((job) => active(job.status))) batchFailed = false;
      completion.value = null;
      if (timer) clearTimeout(timer);
    }
    if (ended.some((job) => job.status === 'failed')) batchFailed = true;
    if (ended.length && count.value === 0) {
      completion.value = batchFailed ? 'failed' : 'done';
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        completion.value = null;
      }, 2600);
      batchFailed = false;
    }
  }
);
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
});
const label = computed(() =>
  [
    t('workspace.jobs'),
    t('jobs.inProgress', { count: count.value }),
    completion.value
      ? t(completion.value === 'done' ? 'jobs.finished' : 'jobs.activityFailed')
      : '',
  ]
    .filter(Boolean)
    .join(' · ')
);
</script>

<template>
  <button
    class="job-activity no-drag"
    v-tip="label"
    :aria-label="t('jobs.activity')"
    @click="$emit('select')"
  >
    <Transition name="job-state" mode="out-in" type="transition">
      <svg
        v-if="completion === 'done'"
        key="done"
        class="job-activity__success"
        width="17"
        height="17"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="m4 10 4 4 8-8"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          pathLength="1"
        />
      </svg>
      <span v-else-if="completion === 'failed'" key="failed" class="job-activity__failure"
        ><AppIcon name="warning" :size="17"
      /></span>
      <svg
        v-else-if="count"
        key="running"
        class="job-activity__running"
        width="17"
        height="17"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="10"
          cy="10"
          r="7"
          stroke="currentColor"
          stroke-width="2"
          stroke-dasharray="32 12"
          stroke-linecap="round"
        />
      </svg>
      <AppIcon v-else key="idle" name="jobs" :size="17" />
    </Transition>
    <Transition name="job-count"
      ><span v-if="count" class="job-activity__count" aria-hidden="true">{{
        count > 99 ? '99+' : count
      }}</span></Transition
    >
    <span class="job-activity__announcement" role="status">{{ label }}</span>
  </button>
</template>

<style scoped>
.job-activity {
  position: relative;
  display: grid;
  place-items: center;
  flex: 0 0 var(--hit-min);
  width: var(--hit-min);
  height: var(--hit-min);
  margin-inline-start: auto;
  margin-inline-end: var(--gap-tight);
  border-radius: var(--radius-control);
  color: var(--text-soft);
  transition:
    background-color 140ms var(--ease-out),
    color 140ms var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .job-activity:hover {
    background: var(--fill-4);
    color: var(--color-base-content);
  }
}
.job-activity__running {
  color: var(--color-primary-text);
  animation: job-spin 1100ms linear infinite;
}
.job-activity__success {
  color: var(--color-success);
}
.job-activity__failure {
  color: var(--color-error);
}
.job-activity__count {
  position: absolute;
  top: -0.15rem;
  right: -0.15rem;
  min-width: 0.85rem;
  padding: 0 0.15rem;
  border-radius: var(--radius-pill);
  background: var(--color-primary);
  color: var(--color-primary-content);
  font-size: 0.55rem;
  line-height: 0.85rem;
  font-variant-numeric: tabular-nums;
}
.job-state-enter-active,
.job-state-leave-active,
.job-count-enter-active,
.job-count-leave-active {
  transition:
    opacity 140ms var(--ease-out),
    transform 140ms var(--ease-out);
}
.job-state-enter-from,
.job-state-leave-to,
.job-count-enter-from,
.job-count-leave-to {
  opacity: 0;
  transform: scale(0.9);
}
.job-activity__announcement {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
@keyframes job-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .job-activity__running {
    animation: none;
  }
  .job-state-enter-active,
  .job-state-leave-active,
  .job-count-enter-active,
  .job-count-leave-active {
    transition: opacity 100ms var(--ease-out);
    transform: none;
  }
  .job-state-enter-from,
  .job-state-leave-to,
  .job-count-enter-from,
  .job-count-leave-to {
    transform: none;
  }
}
</style>
