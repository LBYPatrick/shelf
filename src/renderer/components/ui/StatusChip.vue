<script setup lang="ts">
/**
 * A job's state, as a shape rather than a colour.
 *
 * The icon is the point: colour alone is not a label — it fails for the reader
 * who cannot tell the two apart, and it fails again for anyone glancing at a
 * list of twenty. A dial, a moving ring and a tick are distinguishable in
 * greyscale and at a glance, which is what a list needs.
 */
import { computed } from 'vue';
import AppIcon from './AppIcon.vue';

export type ChipTone = 'pending' | 'running' | 'done' | 'failed';

const props = defineProps<{ tone: ChipTone; label: string }>();

const ICONS: Record<ChipTone, string> = {
  pending: 'history',
  running: 'refresh',
  done: 'check',
  failed: 'warning',
};

const icon = computed(() => ICONS[props.tone]);
</script>

<template>
  <span
    class="chip"
    :class="`chip--${tone}`"
  >
    <AppIcon
      class="chip__icon"
      :name="icon"
      :size="11"
    />
    <span>{{ label }}</span>
  </span>
</template>

<style scoped>
.chip {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.25rem;
  height: 1.125rem;
  padding-inline: 0.375rem;
  border-radius: 999px;
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

/* Tinted from the semantic colours, never from a hardcoded hue. */
.chip--pending {
  background: var(--fill-3);
  color: color-mix(in oklab, var(--color-base-content) 65%, transparent);
}

.chip--running {
  background: color-mix(in oklab, var(--color-primary) 16%, transparent);
  color: var(--color-primary-text, var(--color-primary));
}

.chip--done {
  background: color-mix(in oklab, var(--color-success) 20%, transparent);
  color: var(--color-success-content, var(--color-base-content));
}

.chip--failed {
  background: color-mix(in oklab, var(--color-error) 18%, transparent);
  color: var(--color-error);
}

/*
 * Only the running one turns, and it turns because the thing it describes is
 * still happening. A spinner on a finished job would be motion saying nothing.
 */
.chip--running .chip__icon {
  animation: chip-spin 1.4s linear infinite;
}

@keyframes chip-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .chip--running .chip__icon {
    animation: none;
  }
}
</style>
