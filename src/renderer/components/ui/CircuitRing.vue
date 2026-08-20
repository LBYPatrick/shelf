<script setup lang="ts">
/**
 * A ring traced around the control that is busy.
 *
 * Not a spinner. A spinner is a shape that says "something, somewhere, is
 * working"; this is drawn on the outline of one particular control, so what is
 * working is the thing you are looking at. It is the same idea as the sibling
 * project's, ported: an arc chasing its way round the perimeter while the
 * length of the wait is unknown.
 *
 * The path is a rounded rectangle rather than a circle, because the control is
 * one — a ring inscribed in a pill leaves two gaps at the ends and reads as a
 * badge stuck on rather than as the control's own edge lighting up.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    /** Corner radius. Read from the control being traced when not given. */
    radius?: number;
    strokeWidth?: number;
  }>(),
  { radius: undefined, strokeWidth: 1.5 }
);

const root = ref<HTMLElement>();
const box = ref({ width: 0, height: 0 });
let watcher: ResizeObserver | undefined;

onMounted(() => {
  if (!root.value) return;
  watcher = new ResizeObserver(([entry]) => {
    if (!entry) return;
    box.value = { width: entry.contentRect.width, height: entry.contentRect.height };
  });
  watcher.observe(root.value);
});

onBeforeUnmount(() => watcher?.disconnect());

/*
 * The corner it traces is the corner the control has, read off the control
 * rather than passed in — a number given here is a copy of a token, and a copy
 * of a token is a thing that can disagree with it.
 */
const inherited = computed(() => {
  const parent = root.value?.parentElement;
  if (!parent) return Number.POSITIVE_INFINITY;
  const declared = Number.parseFloat(getComputedStyle(parent).borderTopLeftRadius);
  return Number.isFinite(declared) && declared > 0 ? declared : Number.POSITIVE_INFINITY;
});

/*
 * Centred on the edge rather than inside it: half the stroke sits either side
 * of the control's own border, so the ring *is* that border while it runs
 * instead of a second line drawn just within it.
 */
const path = computed(() => {
  const inset = props.strokeWidth / 2;
  const width = box.value.width - inset * 2;
  const height = box.value.height - inset * 2;
  if (width <= 0 || height <= 0) return '';

  const r = Math.min(props.radius ?? inherited.value, height / 2, width / 2);
  const centre = inset + width / 2;

  // Starting at twelve o'clock and running clockwise, which is the direction a
  // reader expects a thing that is going round to be going.
  return [
    `M ${centre} ${inset}`,
    `H ${inset + width - r}`,
    `A ${r} ${r} 0 0 1 ${inset + width} ${inset + r}`,
    `V ${inset + height - r}`,
    `A ${r} ${r} 0 0 1 ${inset + width - r} ${inset + height}`,
    `H ${inset + r}`,
    `A ${r} ${r} 0 0 1 ${inset} ${inset + height - r}`,
    `V ${inset + r}`,
    `A ${r} ${r} 0 0 1 ${inset + r} ${inset}`,
    'Z',
  ].join(' ');
});
</script>

<template>
  <span
    ref="root"
    class="circuit"
    aria-hidden="true"
  >
    <svg
      v-if="path"
      class="circuit__svg"
      :viewBox="`0 0 ${box.width} ${box.height}`"
      fill="none"
    >
      <path
        class="circuit__arc"
        :d="path"
        :stroke-width="strokeWidth"
        stroke-linecap="round"
        pathLength="100"
        stroke-dasharray="24 100"
      />
    </svg>
  </span>
</template>

<style scoped>
.circuit {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.circuit__svg {
  width: 100%;
  height: 100%;
  overflow: visible;
}

.circuit__arc {
  stroke: var(--color-primary);
  animation: circuit 1.1s linear infinite;
}

@keyframes circuit {
  to {
    stroke-dashoffset: -100;
  }
}

/*
 * Still a mark that says "running", it simply stops travelling. Removing it
 * altogether would take away the only thing on the chip that distinguishes a
 * query in flight from a query that has finished.
 */
@media (prefers-reduced-motion: reduce) {
  .circuit__arc {
    animation: none;
    stroke-dasharray: none;
    stroke-opacity: 0.5;
  }
}
</style>
