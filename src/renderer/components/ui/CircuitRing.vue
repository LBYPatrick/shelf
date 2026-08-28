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
    /**
     * The traced control's own corner radius, in pixels.
     *
     * Read off the control when not given, which is what every caller does — a
     * number passed here is a copy of a token, and a copy of a token is a thing
     * that can disagree with it. Either way it is the radius of the control's
     * *outer* edge; the ring works out where the middle of its border is.
     */
    radius?: number;
    strokeWidth?: number;
  }>(),
  { radius: undefined, strokeWidth: 1.5 }
);

const root = ref<HTMLElement>();
const box = ref({ width: 0, height: 0 });

/**
 * The control's own edge: how round its corner is, and how thick its border.
 *
 * Both are needed and only one was read. The ring is positioned `inset: 0`
 * inside the control, which lands it on the *padding* box — a border's width
 * inside the edge it is supposed to be tracing — and it then used the control's
 * full outer radius for a rectangle that had been shrunk. On the straight sides
 * that is a line a pixel or two in, which reads as one slightly-off line; at the
 * corners the two curves diverge, and you see two.
 */
const edge = ref({ radius: 0, border: 0 });

function readEdge(): void {
  const parent = root.value?.parentElement;
  if (!parent) return;

  const style = getComputedStyle(parent);
  edge.value = {
    radius: Number.parseFloat(style.borderTopLeftRadius) || 0,
    border: Number.parseFloat(style.borderTopWidth) || 0,
  };
}

let watcher: ResizeObserver | undefined;

onMounted(() => {
  if (!root.value) return;
  readEdge();
  watcher = new ResizeObserver(([entry]) => {
    if (!entry) return;
    box.value = { width: entry.contentRect.width, height: entry.contentRect.height };
    // Re-read with the size: a density change or a theme swap moves the radius
    // and the border together with the box, and a value read once at mount
    // would go on describing the control this used to be traced around.
    readEdge();
  });
  watcher.observe(root.value);
});

onBeforeUnmount(() => watcher?.disconnect());

/**
 * How far the ring stands outside its containing block.
 *
 * An absolutely positioned child is laid out against its parent's *padding*
 * box, so `inset: 0` is already a border's width inside the line being traced.
 * Half a border back out puts the ring's own rectangle exactly on the middle of
 * that border, which is where the stroke belongs — half of it either side, so
 * the ring *is* the control's edge while it runs rather than a second line
 * drawn just within it.
 */
const lift = computed(() => edge.value.border / 2);

const path = computed(() => {
  const { width, height } = box.value;
  if (width <= 0 || height <= 0) return '';

  /*
   * The radius on that same middle line, which is the outer radius less the
   * half-border the rectangle came in by. Using the outer radius on an inset
   * rectangle is what put a second curve in every corner.
   */
  const outer = props.radius ?? edge.value.radius;
  const r = Math.max(0, Math.min(outer - lift.value, height / 2, width / 2));

  // Starting at twelve o'clock and running clockwise, which is the direction a
  // reader expects a thing that is going round to be going.
  return [
    `M ${width / 2} 0`,
    `H ${width - r}`,
    `A ${r} ${r} 0 0 1 ${width} ${r}`,
    `V ${height - r}`,
    `A ${r} ${r} 0 0 1 ${width - r} ${height}`,
    `H ${r}`,
    `A ${r} ${r} 0 0 1 0 ${height - r}`,
    `V ${r}`,
    `A ${r} ${r} 0 0 1 ${r} 0`,
    'Z',
  ].join(' ');
});
</script>

<template>
  <span ref="root" class="circuit" :style="{ inset: `${-lift}px` }" aria-hidden="true">
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
        stroke-dasharray="24 76"
      />
    </svg>
  </span>
</template>

<style scoped>
/*
 * `inset` is set inline: how far out the ring sits depends on the control's own
 * border, which only the script can read. Zero is the resting value, so a ring
 * around a borderless control is exactly where it was.
 */
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

/*
 * The dash pattern has to divide the path, or every lap starts where the last
 * one did not finish.
 *
 * `pathLength` normalises the outline to 100 units and the animation advances
 * the offset by exactly that in a lap — so the pattern's own period must be 100
 * too. It was `24 100`, a period of 124, which meant each lap ended 24 units
 * out of phase with the one before and the arc jumped at the wrap. `24 76` is
 * the same arc and the same gap, in a pattern that closes.
 */
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
