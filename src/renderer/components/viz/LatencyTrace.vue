<script setup lang="ts">
/**
 * Every round trip, as its own column.
 *
 * A line through the samples would say the latency passed through every value
 * between two pings, and it did not — there is nothing between two round trips
 * to pass through. Each ping is one observation and is drawn as one, in the
 * order it was taken, so a connection that is slow *sometimes* looks different
 * from one that is slow.
 *
 * Two reference lines, because the two numbers that matter are a typical trip
 * and the worst one. The band between them is the jitter, shaded, so "how much
 * worse does it get" is an area rather than a subtraction the reader performs.
 *
 * `d3-scale` does the mapping; the drawing is ours, for the same reason the
 * statement histogram's is — d3's axis writes DOM Vue does not own and styles
 * it with attributes rather than the token set.
 */
import { computed } from 'vue';
import { scaleLinear } from 'd3-scale';
import type { LatencySummary } from '@shared/latency';

const props = withDefaults(
  defineProps<{
    samples: readonly number[];
    summary: LatencySummary;
    /** How a duration is written, so the chart and the readout agree. */
    format: (ms: number) => string;
    label: string;
    height?: number;
  }>(),
  { height: 116 }
);

const WIDTH = 320;
const PAD = { top: 10, right: 46, bottom: 6, left: 4 } as const;

const inner = computed(() => ({
  width: WIDTH - PAD.left - PAD.right,
  height: props.height - PAD.top - PAD.bottom,
}));

/*
 * The top of the axis is the worst trip with a little air, never zero-to-max
 * exactly — a column that reaches the ceiling reads as clipped rather than as
 * the maximum. The floor is zero because a duration has one.
 */
const y = computed(() =>
  scaleLinear()
    .domain([0, Math.max(props.summary.max * 1.15, 0.001)])
    .range([PAD.top + inner.value.height, PAD.top])
);

const columns = computed(() => {
  const count = Math.max(1, props.samples.length);
  const step = inner.value.width / count;
  // A hair of space between columns, and never a column narrower than a pixel.
  const width = Math.max(1, step - 2);

  return props.samples.map((value, index) => {
    const top = y.value(value);
    return {
      index,
      value,
      x: PAD.left + index * step + (step - width) / 2,
      y: top,
      width,
      height: Math.max(1, PAD.top + inner.value.height - top),
    };
  });
});

const lines = computed(() => [
  { id: 'median', at: y.value(props.summary.median), value: props.summary.median },
  { id: 'max', at: y.value(props.summary.max), value: props.summary.max },
]);

const band = computed(() => {
  const top = y.value(props.summary.max);
  return { y: top, height: Math.max(0, y.value(props.summary.median) - top) };
});
</script>

<template>
  <svg
    class="trace"
    :viewBox="`0 0 ${WIDTH} ${height}`"
    role="img"
    :aria-label="label"
    preserveAspectRatio="none"
  >
    <rect
      class="trace__band"
      :x="PAD.left"
      :y="band.y"
      :width="inner.width"
      :height="band.height"
    />

    <rect
      v-for="column in columns"
      :key="column.index"
      class="trace__bar"
      :x="column.x"
      :y="column.y"
      :width="column.width"
      :height="column.height"
      rx="1"
    />

    <g v-for="line in lines" :key="line.id">
      <line
        :class="`trace__rule trace__rule--${line.id}`"
        :x1="PAD.left"
        :x2="PAD.left + inner.width"
        :y1="line.at"
        :y2="line.at"
      />
      <!--
        The label sits outside the plot, not on it. Over the columns it would
        be unreadable exactly where the chart is busiest, which is the part
        worth reading.
      -->
      <text
        :class="`trace__tick trace__tick--${line.id}`"
        :x="PAD.left + inner.width + 5"
        :y="line.at"
        dominant-baseline="middle"
      >
        {{ format(line.value) }}
      </text>
    </g>
  </svg>
</template>

<style scoped>
.trace {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.trace__bar {
  fill: var(--color-primary);
  opacity: 0.75;
}

.trace__band {
  fill: var(--color-base-content);
  opacity: 0.05;
}

.trace__rule {
  stroke-width: 1;
  /* Non-scaling so a chart stretched to its container keeps a hairline rather
     than a rule that thickens with the box. */
  vector-effect: non-scaling-stroke;
}

.trace__rule--median {
  stroke: var(--color-base-content);
  opacity: 0.35;
}

.trace__rule--max {
  stroke: var(--color-base-content);
  opacity: 0.18;
  stroke-dasharray: 3 3;
}

.trace__tick {
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  fill: color-mix(in oklab, var(--color-base-content) 50%, transparent);
}

.trace__tick--median {
  fill: color-mix(in oklab, var(--color-base-content) 70%, transparent);
}
</style>
