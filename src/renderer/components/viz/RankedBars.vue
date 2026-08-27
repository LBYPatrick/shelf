<script setup lang="ts">
/**
 * Ranked magnitudes, as horizontal bars.
 *
 * Horizontal rather than vertical because the labels are names — a query, a
 * table — and names read along the bar rather than rotated under it. The scale
 * always starts at zero: a bar chart's whole claim is that length is
 * proportional to value, and a truncated axis breaks it.
 *
 * The bars are the picture and never the data. Every number drawn here is also
 * in the table beside it, so the chart carries `role="img"` with a summary and
 * nothing in it needs to be reachable on its own.
 */
import { computed } from 'vue';

export interface Bar {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  /** Shown at the end of the bar, already formatted. */
  readonly display: string;
  /**
   * A second, smaller quantity drawn inside the bar — dead rows inside a
   * table's size, cache misses inside a query's time. Nested rather than
   * stacked, because it is a *part of* the value rather than another one.
   */
  readonly inner?: number;
  readonly tone?: 'accent' | 'warning';
}

const props = withDefaults(
  defineProps<{
    bars: readonly Bar[];
    label: string;
    /** Which bar the table has selected, so the two stay in step. */
    selected?: string | null;
    rowHeight?: number;
  }>(),
  { selected: null, rowHeight: 26 }
);

const emit = defineEmits<{ pick: [string] }>();

const GUTTER = 4;
/** Room for the value at the end of the bar, in the same units as the width. */
const VALUE_WIDTH = 15;

const height = computed(() => Math.max(1, props.bars.length) * props.rowHeight);

/**
 * Widths as percentages of the drawing area rather than pixels.
 *
 * The chart has to survive the pane being resized without re-measuring itself,
 * and a `viewBox` cannot do that alone — it would scale the type with the box.
 * So the geometry is in percent and only the row height is absolute.
 */
const peak = computed(() => Math.max(...props.bars.map((bar) => bar.value), 0) || 1);

function widthOf(value: number): number {
  return Math.max(0, (value / peak.value) * (100 - VALUE_WIDTH));
}
</script>

<template>
  <div class="bars" role="img" :aria-label="label" :style="{ height: `${height}px` }">
    <div
      v-for="bar in bars"
      :key="bar.id"
      class="bars__row"
      :class="{ 'bars__row--on': bar.id === selected }"
      :style="{
        height: `${rowHeight - GUTTER}px`,
        '--fill': `${widthOf(bar.value)}%`,
        '--inner': `${widthOf(bar.inner ?? 0)}%`,
      }"
      @pointerdown="emit('pick', bar.id)"
    >
      <span class="bars__fill" :class="`bars__fill--${bar.tone ?? 'accent'}`" />
      <!--
        The part sits at the *end* of the whole, not at its start. Drawn from
        the same edge it reads as a second, shorter bar racing the first; drawn
        at the tip it reads as the portion of the bar that is the problem — and
        it stops covering the label, which begins at the same edge.
      -->
      <span v-if="bar.inner !== undefined && bar.inner > 0" class="bars__inner" />
      <!--
        Drawn over the bar, not after it. A label placed after a bar moves as
        the value changes, so a column of them zig-zags down the chart and the
        eye has to find each one; pinned to the axis they form a straight edge.
      -->
      <span class="bars__label">{{ bar.label }}</span>
      <span class="bars__value">{{ bar.display }}</span>
    </div>
  </div>
</template>

<style scoped>
.bars {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}

/*
 * The row is the track and the fill is the bar.
 *
 * Without a track a short bar is a floating pill: there is nothing to read the
 * length *against*, so the eye compares each bar to its neighbours instead of
 * to the whole, and the smallest values stop looking small.
 */
.bars__row {
  position: relative;
  display: flex;
  align-items: center;
  border-radius: var(--radius-field);
  background: var(--fill-3);
  overflow: hidden;
  cursor: default;
}

.bars__fill,
.bars__inner {
  position: absolute;
  inset-block: 0;
  border-radius: var(--radius-field);
  transition:
    width var(--t-pop) var(--ease-out),
    inset-inline-start var(--t-pop) var(--ease-out);
}

.bars__fill {
  inset-inline-start: 0;
  width: var(--fill);
}

.bars__inner {
  inset-inline-start: calc(var(--fill) - var(--inner));
  width: var(--inner);
}

.bars__fill--accent {
  background: color-mix(in oklab, var(--color-primary) 22%, transparent);
}

.bars__fill--warning {
  background: color-mix(in oklab, var(--color-warning) 30%, transparent);
}

/* The part inside the whole, drawn solid so it reads as contained rather than
   as a second bar starting from the same edge. */
.bars__inner {
  background: color-mix(in oklab, var(--color-error) 34%, transparent);
}

.bars__row--on .bars__fill {
  background: color-mix(in oklab, var(--color-primary) 40%, transparent);
}

.bars__label {
  position: relative;
  flex: 1;
  min-width: 0;
  padding-inline-start: var(--gap);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
}

.bars__value {
  position: relative;
  flex: 0 0 auto;
  padding-inline: var(--gap);
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  color: color-mix(in oklab, var(--color-base-content) 66%, transparent);
}

@media (hover: hover) and (pointer: fine) {
  .bars__row:hover .bars__fill--accent {
    background: color-mix(in oklab, var(--color-primary) 32%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .bars__fill,
  .bars__inner {
    transition: none;
  }
}
</style>
