<script setup lang="ts">
/**
 * One notice.
 *
 * It owns its own expiry so the countdown can pause under the pointer. A
 * message that leaves while you are reaching for its action button is a message
 * you were not offered.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { Toast } from '../../stores/toasts';
import AppIcon from '../ui/AppIcon.vue';

const props = defineProps<{ notice: Toast }>();
const emit = defineEmits<{ dismiss: [] }>();

const ICON: Record<Toast['tone'], string> = {
  info: 'info',
  success: 'check',
  warning: 'warning',
  error: 'warning',
};

/*
 * A failure is an alert and gets read out of turn; the rest are status and wait
 * their turn. Saying everything urgently is the same as saying nothing is.
 */
const live = computed(() =>
  props.notice.tone === 'error' || props.notice.tone === 'warning' ? 'alert' : 'status'
);

let timer: ReturnType<typeof setTimeout> | undefined;
const remaining = ref(props.notice.expire ?? 0);
let startedAt = 0;

function start(): void {
  if (!remaining.value) return;
  startedAt = performance.now();
  timer = setTimeout(() => emit('dismiss'), remaining.value);
}

function pause(): void {
  if (!timer) return;
  clearTimeout(timer);
  timer = undefined;
  remaining.value = Math.max(0, remaining.value - (performance.now() - startedAt));
}

function resume(): void {
  if (timer || remaining.value <= 0) return;
  start();
}

onMounted(start);
onBeforeUnmount(() => clearTimeout(timer));

function act(): void {
  props.notice.action?.run();
  emit('dismiss');
}
</script>

<template>
  <div
    class="notice surface-popover"
    :class="`notice--${notice.tone}`"
    :role="live"
    @pointerenter="pause"
    @pointerleave="resume"
    @focusin="pause"
    @focusout="resume"
  >
    <AppIcon class="notice__mark" :name="ICON[notice.tone]" :size="14" />

    <div class="notice__body">
      <p v-if="notice.title" class="notice__title">
        {{ notice.title }}
      </p>
      <p class="notice__message">
        {{ notice.message }}
      </p>
    </div>

    <button v-if="notice.action" type="button" class="notice__action focus-fill" @click="act">
      {{ notice.action.label }}
    </button>

    <button
      type="button"
      class="notice__close focus-fill"
      :aria-label="$t('action.close')"
      @click="emit('dismiss')"
    >
      <AppIcon name="close" :size="10" />
    </button>
  </div>
</template>

<style scoped>
.notice {
  display: flex;
  align-items: center;
  gap: var(--gap);
  width: min(24rem, calc(100vw - 2rem));
  padding: var(--gap) var(--gap-tight) var(--gap) var(--gap-loose);
  border-radius: var(--radius-box);
}

/*
 * The tone is carried by the mark and a hairline, not by a coloured slab. A
 * notice is a sentence on a surface; flooding the surface with the tone makes
 * the text sit on colour and takes the material with it.
 */
.notice__mark {
  flex: 0 0 auto;
  color: var(--color-base-content);
}

.notice--success .notice__mark {
  color: var(--color-success);
}

.notice--warning .notice__mark {
  color: var(--color-warning);
}

.notice--error .notice__mark {
  color: var(--color-error);
}

.notice--error,
.notice--warning {
  border: 1px solid color-mix(in oklab, var(--color-error) 30%, transparent);
}

.notice--warning {
  border-color: color-mix(in oklab, var(--color-warning) 34%, transparent);
}

.notice__body {
  flex: 1;
  min-width: 0;
}

.notice__title {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
}

.notice__message {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.35;
  color: color-mix(in oklab, var(--color-base-content) 78%, transparent);
}

.notice__action {
  flex: 0 0 auto;
  height: var(--field-h);
  padding-inline: var(--gap);
  border-radius: var(--control-radius);
  font-size: 0.75rem;
  font-weight: 550;
  color: var(--color-primary-text, var(--color-primary));
}

.notice__close {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: var(--hit-min);
  height: var(--hit-min);
  border-radius: var(--control-radius);
  color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
}

@media (hover: hover) and (pointer: fine) {
  .notice__action:hover,
  .notice__close:hover {
    background: var(--fill-4);
  }

  .notice__close:hover {
    color: var(--color-base-content);
  }
}
</style>
