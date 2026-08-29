<script setup lang="ts">
/**
 * A part-to-whole split: a ring, and the parts written out beside it.
 *
 * The two halves do different jobs, which is why both are here. A ring is good
 * at saying "this is one quantity, divided" and bad at letting you compare the
 * divisions — so the total goes in its middle, where it is read first, and the
 * comparing is done by bars in the list, where length is proportional and the
 * eye is good at it.
 *
 * The list used to be a narrow column pinned beside the ring, which left two
 * thirds of the card empty and stranded the counts in the middle of it. It
 * fills the width now, which is also what makes a row a target worth hovering.
 *
 * `d3-shape` lays out the arcs. The angles are trivial arithmetic; the path
 * data for an annular sector with rounded ends is not, and hand-rolling it is
 * how charts end up with a seam at twelve o'clock.
 */
import { computed, ref } from 'vue';
import { arc as makeArc, pie as makePie } from 'd3-shape';

export interface Slice {
  readonly id: string;
  readonly label: string;
  readonly value: number;
}

const props = withDefaults(
  defineProps<{
    slices: readonly Slice[];
    /** Drawn in the middle, already formatted. */
    total: string;
    caption: string;
    size?: number;
  }>(),
  { size: 116 }
);

const RADIUS = 50;
const THICKNESS = 15;

/**
 * Hues stepped around from the accent rather than picked.
 *
 * A hand-picked set drifts from the theme the moment the accent changes, and
 * the states being distinguished have no inherent colours — they only have to
 * be told apart. Even steps in OKLCH hue are as far apart as the space allows
 * while staying the same weight, which is what keeps one slice from shouting.
 */
function colourFor(index: number, count: number): string {
  const spread = count > 1 ? (index / count) * 200 : 0;
  return `oklch(62% 0.14 calc(var(--accent-hue) * 1deg + ${spread}deg))`;
}

/**
 * One highlight, shared by the ring and the list.
 *
 * Hovering either end lights the other, because the whole reason the two sit
 * together is that they are two views of one number — and a slice you cannot
 * name is a slice you cannot use.
 */
const active = ref<string | null>(null);

const whole = computed(() => props.slices.reduce((sum, slice) => sum + slice.value, 0));

const layout = computed(() => {
  if (whole.value <= 0) return [];

  const arcs = makePie<Slice>()
    .value((slice) => slice.value)
    .sort(null)
    .padAngle(0.02)(props.slices as Slice[]);

  const path = makeArc<(typeof arcs)[number]>()
    .innerRadius(RADIUS - THICKNESS)
    .outerRadius(RADIUS)
    .cornerRadius(3);

  return arcs.map((entry, index) => ({
    id: entry.data.id,
    label: entry.data.label,
    value: entry.data.value,
    share: entry.data.value / whole.value,
    d: path(entry) ?? '',
    colour: colourFor(index, arcs.length),
  }));
});

const percent = (share: number) =>
  share >= 0.1 || share === 0 ? `${Math.round(share * 100)}%` : `${(share * 100).toFixed(1)}%`;
</script>

<template>
  <figure class="donut" @pointerleave="active = null">
    <svg
      class="donut__svg"
      :width="size"
      :height="size"
      viewBox="-55 -55 110 110"
      role="img"
      :aria-label="caption"
    >
      <path
        v-for="slice in layout"
        :key="slice.id"
        class="donut__arc"
        :class="{ 'donut__arc--dim': active !== null && active !== slice.id }"
        :d="slice.d"
        :fill="slice.colour"
        @pointerenter="active = slice.id"
      />
      <text class="donut__total" text-anchor="middle" dominant-baseline="central">
        {{ total }}
      </text>
    </svg>

    <!--
      A legend, not labels on the arcs. Leader lines to four slices in a ring
      this size take more room than the ring, and the value belongs next to the
      word rather than floating beside a wedge.
    -->
    <figcaption class="donut__legend">
      <div
        v-for="slice in layout"
        :key="slice.id"
        class="donut__entry"
        :class="{ 'donut__entry--on': active === slice.id }"
        :style="{ '--share': `${(slice.share * 100).toFixed(2)}%`, '--slice': slice.colour }"
        @pointerenter="active = slice.id"
      >
        <span class="donut__swatch" aria-hidden="true" />
        <span class="donut__name">{{ slice.label }}</span>
        <!--
          The bar is what makes two states comparable; the ring only says that
          the whole is divided. It sits between the name and the number so the
          three read as one line rather than as three columns with a gulf
          between them.
        -->
        <span class="donut__bar" aria-hidden="true" />
        <span class="donut__value">{{ slice.value.toLocaleString() }}</span>
        <span class="donut__percent">{{ percent(slice.share) }}</span>
      </div>
    </figcaption>
  </figure>
</template>

<style scoped>
.donut {
  display: flex;
  align-items: center;
  gap: var(--gap-section);
  margin: 0;
}

.donut__svg {
  flex: 0 0 auto;
  /* The hovered arc grows past the viewBox; clipping it would flatten the one
     edge the movement exists to show. */
  overflow: visible;
}

/*
 * The hovered arc lifts out of the ring and the rest step back. Scaled from the
 * centre, so it reads as one wedge coming forward rather than as the ring
 * changing size.
 */
.donut__arc {
  transform-box: view-box;
  transform-origin: center;
  transition:
    opacity var(--t-hover) var(--ease-out),
    transform var(--t-pop) var(--ease-out);
}

.donut__arc--dim {
  opacity: 0.35;
}

@media (hover: hover) and (pointer: fine) {
  .donut__arc:hover {
    transform: scale(1.05);
  }
}

.donut__total {
  fill: var(--color-base-content);
  font-size: 17px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.donut__legend {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

/* A row, not a legend entry: it fills the card, so it is a target, so it
   behaves like one. */
.donut__entry {
  display: flex;
  align-items: center;
  gap: var(--gap);
  height: var(--row-h);
  padding-inline: var(--gap);
  border-radius: var(--radius-field);
  font-size: 0.8125rem;
  cursor: default;
  transition: background-color var(--t-hover) var(--ease-out);
}

.donut__entry--on {
  background-color: var(--fill-3);
}

.donut__swatch {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--slice);
  transition: transform var(--t-pop) var(--ease-out);
}

.donut__entry--on .donut__swatch {
  transform: scale(1.35);
}

.donut__name {
  flex: 0 0 auto;
  min-width: 7rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: color-mix(in oklab, var(--color-base-content) 82%, transparent);
}

/* A track and a fill, so a short bar is short *against* something. */
.donut__bar {
  position: relative;
  flex: 1;
  min-width: 2rem;
  height: 6px;
  border-radius: 999px;
  background: var(--fill-4);
  overflow: hidden;
}

.donut__bar::before {
  content: '';
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  width: var(--share);
  border-radius: 999px;
  background: var(--slice);
  opacity: 0.75;
  transition:
    width var(--t-pop) var(--ease-out),
    opacity var(--t-hover) var(--ease-out);
}

.donut__entry--on .donut__bar::before {
  opacity: 1;
}

.donut__value {
  flex: 0 0 auto;
  min-width: 3rem;
  text-align: end;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

.donut__percent {
  flex: 0 0 auto;
  min-width: 2.75rem;
  text-align: end;
  font-variant-numeric: tabular-nums;
  font-size: 0.6875rem;
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .donut__arc:hover {
    transform: none;
  }

  .donut__entry--on .donut__swatch {
    transform: none;
  }
}
</style>
