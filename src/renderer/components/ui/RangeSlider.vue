<script setup lang="ts">
/**
 * A slider.
 *
 * The native input, drawn over rather than replaced. It already tracks the
 * pointer one to one, respects where you grabbed the thumb, handles arrow keys
 * and page keys, and announces itself — reimplementing that on a div would lose
 * all four to gain nothing but a different DOM.
 *
 * The filled portion is painted with a gradient on the track rather than a
 * second element, because a pseudo-element would have to know the value and
 * the value only exists in the input.
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    min?: number;
    max?: number;
    step?: number;
    ariaLabel: string;
    /** Rendered at the end of the track — the value in the unit people think in. */
    display?: string;
  }>(),
  { min: 0, max: 100, step: 1, display: undefined }
);

const model = defineModel<number>({ required: true });

/** Where the fill ends, as a fraction of the track. */
const progress = computed(() => {
  const span = props.max - props.min;
  if (span <= 0) return 0;
  return (model.value - props.min) / span;
});
</script>

<template>
  <div class="slider">
    <input
      v-model.number="model"
      class="slider__input"
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :aria-label="ariaLabel"
      :style="{ '--progress': progress }"
    >
    <span
      v-if="display !== undefined"
      class="slider__value"
      aria-hidden="true"
    >{{
      display
    }}</span>
  </div>
</template>

<style scoped>
.slider {
  display: flex;
  align-items: center;
  gap: var(--gap-loose);
}

.slider__input {
  flex: 1;
  min-width: 0;
  height: var(--hit-min);
  appearance: none;
  background: transparent;
}

/*
 * The track is drawn on the input's own background so the fill can be a
 * gradient stop at the current value — one element, no measuring.
 */
.slider__input::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    var(--color-primary) 0 calc(var(--progress) * 100%),
    var(--fill-2) calc(var(--progress) * 100%) 100%
  );
}

.slider__input::-webkit-slider-thumb {
  appearance: none;
  width: 1rem;
  height: 1rem;
  /* Half the thumb's height above the 4px track, so it rides centred on it. */
  margin-top: -0.375rem;
  border-radius: 999px;
  background: var(--control-thumb);
  box-shadow: var(--elev-thumb);
  transition: transform var(--t-press) var(--ease-out);
}

/* Feedback on the press, not on the release. */
.slider__input:active::-webkit-slider-thumb {
  transform: scale(1.15);
}

.slider__input:focus-visible::-webkit-slider-thumb {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.slider__value {
  flex: 0 0 auto;
  min-width: 2.75rem;
  text-align: end;
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .slider__input:active::-webkit-slider-thumb {
    transform: none;
  }
}
</style>
