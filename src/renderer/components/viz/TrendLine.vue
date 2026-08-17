<script setup lang="ts">
/**
 * How a rate has moved across the readings the app has taken.
 *
 * The points are real and irregular: one per sample, taken whenever the tab
 * refreshed, so the horizontal axis is time and not sample number. Plotting
 * them evenly spaced would draw a gap left open overnight as a smooth slope,
 * which is the one thing a trend line must not do.
 *
 * `d3-shape` draws it. `curveMonotoneX` matters here rather than being
 * decoration: a plain smoothing curve overshoots between points and invents
 * peaks the data never had, and this chart's whole job is to say where the
 * peaks were.
 */
import { computed } from 'vue';
import { area as makeArea, curveMonotoneX, line as makeLine } from 'd3-shape';

export interface Point {
  readonly at: number;
  readonly value: number;
}

const props = withDefaults(
  defineProps<{ points: readonly Point[]; label: string; height?: number }>(),
  { height: 64 }
);

/** Drawn in a unit box and stretched by the SVG, so it needs no measuring. */
const WIDTH = 100;

const shape = computed(() => {
  const points = [...props.points].sort((a, b) => a.at - b.at);
  if (points.length < 2) return null;

  const first = points[0]!.at;
  const last = points[points.length - 1]!.at;
  const span = Math.max(1, last - first);
  const peak = Math.max(...points.map((point) => point.value), 0) || 1;

  const x = (point: Point) => ((point.at - first) / span) * WIDTH;
  // Ten percent of headroom, so the highest point is a peak rather than a lid.
  const y = (point: Point) => props.height - (point.value / (peak * 1.1)) * props.height;

  const line = makeLine<Point>().x(x).y(y).curve(curveMonotoneX);
  const area = makeArea<Point>().x(x).y0(props.height).y1(y).curve(curveMonotoneX);

  return { line: line(points) ?? '', area: area(points) ?? '', peak };
});
</script>

<template>
  <svg
    v-if="shape"
    class="trend"
    :viewBox="`0 0 ${WIDTH} ${height}`"
    preserveAspectRatio="none"
    role="img"
    :aria-label="label"
  >
    <path
      class="trend__area"
      :d="shape.area"
    />
    <!--
      `vector-effect` keeps the stroke a hairline after the non-uniform stretch
      the `preserveAspectRatio` above applies. Without it the line thins to
      nothing horizontally and thickens vertically.
    -->
    <path
      class="trend__line"
      :d="shape.line"
      vector-effect="non-scaling-stroke"
    />
  </svg>
</template>

<style scoped>
.trend {
  display: block;
  width: 100%;
}

.trend__area {
  fill: color-mix(in oklab, var(--color-primary) 14%, transparent);
}

.trend__line {
  fill: none;
  stroke: var(--color-primary);
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
