<script setup lang="ts">
/**
 * When the server was busy, as columns of time.
 *
 * This replaced a smoothed line, and the reason is what the two are claiming. A
 * line through the readings says the rate was continuous and that it passed
 * through every point between them — but the readings are ten minutes apart at
 * best and a night apart at worst, and there is nothing between them to pass
 * through. Columns claim only what is true: this much work happened somewhere
 * inside this span of time, and a span nothing was recording during is drawn as
 * absent rather than as zero.
 *
 * Three things can be changed here, and all three are questions the numbers
 * genuinely raise:
 *
 *  - **The vertical scale.** One statement storm is routinely a thousand times
 *    the ordinary load, and on a linear axis it flattens every other column to
 *    the axis. A log axis is the only way to see both at once, and it is a
 *    lie by default — so it is a choice, stated on the control.
 *  - **The column width.** Coarse says whether yesterday was worse than today;
 *    fine says which ten minutes it went wrong.
 *  - **The range.** Dragging across the chart selects a span and everything
 *    below it — the ranking, the table, the totals — re-answers for exactly
 *    that span. This is the question the six fixed windows cannot ask.
 *
 * `d3-scale` does the mapping and `d3-array` the ticks; the drawing is ours,
 * because d3's own axis component writes DOM Vue does not own and styles it
 * with attributes rather than the token set.
 */
import { computed, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { ticks as makeTicks } from 'd3-array';
import { scaleLinear, scaleSymlog, scaleTime, type ScaleContinuousNumeric } from 'd3-scale';
import type { Bucket } from '@shared/queryStats';

export type Scale = 'linear' | 'log';

const props = withDefaults(
  defineProps<{
    buckets: readonly Bucket[];
    /** The selected span, in epoch milliseconds, or null for the whole chart. */
    selection?: readonly [number, number] | null;
    label: string;
    /** How a value is written, so the axis and the chart agree with the table. */
    format: (value: number) => string;
    formatTime: (at: number) => string;
    height?: number;
  }>(),
  { selection: null, height: 148 }
);

const emit = defineEmits<{ select: [readonly [number, number] | null] }>();

const scale = ref<Scale>('linear');

/** Room for the axis labels, in pixels, inside the drawing box. */
const PAD = { top: 8, right: 8, bottom: 18, left: 46 } as const;

const plot = ref<SVGRectElement>();

const span = computed<readonly [number, number]>(() => {
  const first = props.buckets[0];
  const last = props.buckets[props.buckets.length - 1];
  if (!first || !last) return [0, 1];
  return [first.from, last.to];
});

/**
 * A rate, not a total: the columns are equal in time but the *recorded* part of
 * each is not, so a column half of which nobody was watching would otherwise
 * read as half as busy. Milliseconds of statement time per second of observed
 * wall clock — a value of 1000 means the server spent a full second of every
 * second inside a statement.
 */
function rateOf(bucket: Bucket): number {
  return bucket.coveredSeconds <= 0 ? 0 : bucket.totalMs / bucket.coveredSeconds;
}

const peak = computed(() => Math.max(...props.buckets.map(rateOf), 0));

/*
 * Symlog rather than log, and the difference matters here: a quiet column is
 * exactly zero, which a log scale has no answer for at all. Symlog is linear
 * through zero and logarithmic beyond it, so the empty columns stay on the axis
 * where they belong.
 */
const y = computed<ScaleContinuousNumeric<number, number>>(() => {
  const top = peak.value > 0 ? peak.value * 1.1 : 1;
  const range: [number, number] = [props.height - PAD.bottom, PAD.top];
  return scale.value === 'log'
    ? scaleSymlog().domain([0, top]).range(range)
    : scaleLinear().domain([0, top]).range(range);
});

/** Drawn in a box 1000 wide and stretched, so the columns need no measuring. */
const WIDTH = 1000;

const x = computed(() =>
  scaleTime()
    .domain([new Date(span.value[0]), new Date(span.value[1])])
    .range([PAD.left, WIDTH - PAD.right])
);

const columns = computed(() =>
  props.buckets.map((bucket) => {
    const left = x.value(new Date(bucket.from));
    const right = x.value(new Date(bucket.to));
    const rate = rateOf(bucket);
    const top = y.value(rate);
    return {
      key: bucket.from,
      x: left,
      // A hairline of gutter, and never so much that a narrow column vanishes.
      width: Math.max(0.5, right - left - 1),
      y: top,
      height: Math.max(0, props.height - PAD.bottom - top),
      rate,
      observed: bucket.coveredSeconds > 0,
      inSelection: inSelection(bucket),
      bucket,
    };
  })
);

function inSelection(bucket: Bucket): boolean {
  const chosen = props.selection;
  if (!chosen) return true;
  return bucket.to > chosen[0] && bucket.from < chosen[1];
}

/** Four horizontal rules at most: more of them is graph paper, not a scale. */
const valueTicks = computed(() => {
  const top = y.value.domain()[1] ?? 1;
  const raw =
    scale.value === 'log'
      ? [top, top / 10, top / 100].filter((value) => value >= 1)
      : makeTicks(0, top, 4);
  return raw
    .filter((value) => value > 0)
    .map((value) => ({ value, y: y.value(value) }))
    .filter((tick) => tick.y >= PAD.top && tick.y <= props.height - PAD.bottom);
});

/** Three moments along the bottom: the two ends and the middle. */
const timeTicks = computed(() => {
  const [from, to] = span.value;
  if (to <= from) return [];
  return [from, (from + to) / 2, to].map((at, index) => ({
    at,
    x: x.value(new Date(at)),
    anchor: index === 0 ? 'start' : index === 2 ? 'end' : 'middle',
  }));
});

const selectionBox = computed(() => {
  const chosen = props.selection;
  if (!chosen) return null;
  const left = x.value(new Date(chosen[0]));
  const right = x.value(new Date(chosen[1]));
  return { x: Math.min(left, right), width: Math.abs(right - left) };
});

/* ------------------------------------------------------------------ dragging */

/**
 * Selecting a span, one to one with the pointer.
 *
 * Not `useDrag`: that composable moves a *value* from where it started, which
 * is what a divider or a slider does. A brush has no starting value — it is two
 * positions, both of which come from the gesture — and it must be able to be
 * drawn backwards, so the anchor is kept and the ends sorted rather than the
 * delta being applied to anything.
 */
const dragging = ref(false);
let anchor: number | null = null;

/** Below this the gesture was a click, and a click clears the selection. */
const DRAG_MIN_PX = 4;

function timeAt(event: PointerEvent): number {
  const box = plot.value?.getBoundingClientRect();
  if (!box || box.width === 0) return span.value[0];

  // The plot rect is the drawing area itself, so its own box maps straight onto
  // the time domain without having to subtract the padding again.
  const share = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
  const [from, to] = span.value;
  return from + share * (to - from);
}

function beginBrush(event: PointerEvent): void {
  if (event.button !== 0) return;
  const target = event.currentTarget as SVGRectElement;
  target.setPointerCapture(event.pointerId);
  anchor = timeAt(event);
  dragging.value = true;
  emit('select', null);
}

function moveBrush(event: PointerEvent): void {
  if (anchor === null) return;
  const now = timeAt(event);
  emit('select', [Math.min(anchor, now), Math.max(anchor, now)]);
}

function endBrush(event: PointerEvent): void {
  if (anchor === null) return;

  const box = plot.value?.getBoundingClientRect();
  const travelled = box
    ? Math.abs(((timeAt(event) - anchor) / (span.value[1] - span.value[0] || 1)) * box.width)
    : 0;

  if (travelled < DRAG_MIN_PX) emit('select', null);

  anchor = null;
  dragging.value = false;
  if (
    event.currentTarget instanceof Element &&
    event.currentTarget.hasPointerCapture(event.pointerId)
  ) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
}

// A selection is a range of *time*, and a different window is a different
// stretch of it — one drawn over yesterday means nothing over the last hour.
watch(span, () => emit('select', null));

const { t } = useTranslation();

const scales = computed(() => [
  { value: 'linear' as const, label: t('analyze.scaleLinear') },
  { value: 'log' as const, label: t('analyze.scaleLog') },
]);
</script>

<template>
  <div class="histogram">
    <div class="histogram__head">
      <p class="histogram__hint">
        {{
          selection
            ? `${formatTime(selection[0])} – ${formatTime(selection[1])}`
            : $t('analyze.brushHint')
        }}
      </p>

      <button
        v-if="selection"
        type="button"
        class="histogram__clear focus-fill"
        @click="emit('select', null)"
      >
        {{ $t('analyze.wholeRange') }}
      </button>

      <!--
        Two buttons rather than the segmented control: the control's travelling
        indicator is a statement that the two options are ends of one axis, and
        these are two different pictures of the same numbers.
      -->
      <div class="histogram__scales" role="group" :aria-label="$t('analyze.scaleLabel')">
        <button
          v-for="option in scales"
          :key="option.value"
          type="button"
          class="histogram__scale focus-fill"
          :class="{ 'histogram__scale--on': scale === option.value }"
          :aria-pressed="scale === option.value"
          @click="scale = option.value"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <svg
      class="histogram__chart"
      :class="{ 'histogram__chart--dragging': dragging }"
      :viewBox="`0 0 ${WIDTH} ${height}`"
      preserveAspectRatio="none"
      role="img"
      :aria-label="label"
    >
      <!--
        `vector-effect` throughout: the box is stretched horizontally to whatever
        the pane is wide, and without it every rule and every stroke stretches
        with it — a hairline becomes a band and the type would too, which is why
        the type is drawn at a size that survives the stretch instead.
      -->
      <g class="histogram__grid">
        <line
          v-for="tick in valueTicks"
          :key="tick.value"
          :x1="PAD.left"
          :x2="WIDTH - PAD.right"
          :y1="tick.y"
          :y2="tick.y"
          vector-effect="non-scaling-stroke"
        />
      </g>

      <g class="histogram__axis">
        <text
          v-for="tick in valueTicks"
          :key="tick.value"
          :x="PAD.left - 6"
          :y="tick.y + 3"
          text-anchor="end"
        >
          {{ format(tick.value) }}
        </text>
        <text
          v-for="tick in timeTicks"
          :key="tick.at"
          :x="tick.x"
          :y="height - 5"
          :text-anchor="tick.anchor"
        >
          {{ formatTime(tick.at) }}
        </text>
      </g>

      <rect
        v-if="selectionBox"
        class="histogram__selection"
        :x="selectionBox.x"
        :y="PAD.top"
        :width="selectionBox.width"
        :height="height - PAD.bottom - PAD.top"
      />

      <g>
        <rect
          v-for="column in columns"
          :key="column.key"
          class="histogram__bar"
          :class="{
            'histogram__bar--dim': !column.inSelection,
            'histogram__bar--gap': !column.observed,
          }"
          :x="column.x"
          :y="column.observed ? column.y : height - PAD.bottom - 1"
          :width="column.width"
          :height="column.observed ? column.height : 1"
        />
      </g>

      <!--
        The gesture surface is one rectangle over the whole plot rather than
        handlers on every bar: a brush is a drag across the chart, and a bar
        that swallowed the press would make the columns the only place you could
        start one.
      -->
      <rect
        ref="plot"
        class="histogram__plot"
        :x="PAD.left"
        :y="PAD.top"
        :width="WIDTH - PAD.left - PAD.right"
        :height="height - PAD.top - PAD.bottom"
        @pointerdown="beginBrush"
        @pointermove="moveBrush"
        @pointerup="endBrush"
        @pointercancel="endBrush"
      />
    </svg>
  </div>
</template>

<style scoped>
.histogram {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
}

.histogram__head {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
}

.histogram__hint {
  flex: 1;
  min-width: 0;
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.histogram__clear,
.histogram__scale {
  height: var(--hit-min);
  padding-inline: var(--gap);
  border-radius: var(--control-radius);
  font-size: 0.6875rem;
  font-weight: 500;
  color: color-mix(in oklab, var(--color-base-content) 66%, transparent);
}

.histogram__scales {
  display: flex;
  gap: 2px;
}

.histogram__scale--on {
  background: color-mix(in oklab, var(--color-primary) 14%, transparent);
  color: var(--color-primary-text, var(--color-primary));
}

@media (hover: hover) and (pointer: fine) {
  .histogram__clear:hover,
  .histogram__scale:not(.histogram__scale--on):hover {
    background: var(--fill-4);
    color: var(--color-base-content);
  }
}

/*
 * An explicit height, in `rem` so a larger OS text size takes the chart with
 * it. The line this replaced set only a width and let the intrinsic ratio of
 * its `viewBox` decide the rest — which in a sheet a thousand pixels wide made
 * a chart six hundred pixels tall, filling the panel with empty plot area and
 * pushing everything worth reading below the fold.
 */
.histogram__chart {
  display: block;
  width: 100%;
  height: 9.25rem;
}

.histogram__chart--dragging {
  cursor: ew-resize;
}

.histogram__grid line {
  stroke: var(--separator);
  stroke-width: 1;
}

.histogram__axis text {
  fill: color-mix(in oklab, var(--color-base-content) 45%, transparent);
  font-family: var(--font-ui);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
}

.histogram__bar {
  fill: var(--color-primary);
  transition: fill-opacity var(--t-hover) var(--ease-out);
}

/* Outside the selection, still drawn — the shape of the whole history is the
   context that makes a selected span mean anything. */
.histogram__bar--dim {
  fill-opacity: 0.22;
}

/* A stretch nothing was recording during is a hairline on the axis, which is
   visibly not a zero-height bar. */
.histogram__bar--gap {
  fill: color-mix(in oklab, var(--color-base-content) 28%, transparent);
}

.histogram__selection {
  fill: color-mix(in oklab, var(--color-primary) 10%, transparent);
  stroke: color-mix(in oklab, var(--color-primary) 45%, transparent);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.histogram__plot {
  fill: transparent;
  cursor: ew-resize;
  touch-action: none;
}

@media (prefers-reduced-motion: reduce) {
  .histogram__bar {
    transition: none;
  }
}
</style>
