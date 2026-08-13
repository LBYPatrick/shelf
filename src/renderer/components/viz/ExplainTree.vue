<script setup lang="ts">
/**
 * A query plan as a tree.
 *
 * Node width is scaled to cost, so the expensive step is the wide one — the
 * thing you are looking for is the thing that stands out, without reading any
 * numbers. Hot steps are tinted toward the warning colour on the same scale.
 */
import { computed } from 'vue';
import { hierarchy, tree, type HierarchyPointNode } from 'd3-hierarchy';
import { linkVertical } from 'd3-shape';
import { maxCost, type PlanNode } from '@shared/explain';

const props = defineProps<{ plan: PlanNode }>();

const NODE_HEIGHT = 34;
const MIN_WIDTH = 92;
const MAX_WIDTH = 220;
const LEVEL_GAP = 78;

const ceiling = computed(() => maxCost(props.plan) || 1);

/** How expensive this node is, 0 to 1, used for both width and tint. */
function weight(node: PlanNode): number {
  return Math.min((node.cost ?? 0) / ceiling.value, 1);
}

function widthOf(node: PlanNode): number {
  return MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * weight(node);
}

const layout = computed(() => {
  const root = hierarchy(props.plan, (node) => node.children as PlanNode[]);
  const build = tree<PlanNode>().nodeSize([MAX_WIDTH + 24, LEVEL_GAP]);
  return build(root);
});

const nodes = computed(() => layout.value.descendants());

const curve = linkVertical<unknown, HierarchyPointNode<PlanNode>>()
  .x((node) => node.x)
  .y((node) => node.y);

const links = computed(() =>
  layout.value.links().map((link, index) => ({
    key: index,
    d: curve({ source: link.source, target: link.target } as never) ?? '',
  }))
);

const viewBox = computed(() => {
  const xs = nodes.value.map((node) => node.x);
  const ys = nodes.value.map((node) => node.y);
  const padding = MAX_WIDTH / 2 + 32;

  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - 40;

  return `${minX} ${minY} ${Math.max(...xs) - minX + padding} ${Math.max(...ys) - minY + NODE_HEIGHT + 40}`;
});

function format(value: number | undefined): string {
  if (value === undefined) return '';
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value * 10) / 10);
}
</script>

<template>
  <div class="plan">
    <svg
      class="plan__svg"
      :viewBox="viewBox"
      preserveAspectRatio="xMidYMin meet"
      role="img"
      aria-label="Query plan"
    >
      <g>
        <path
          v-for="link in links"
          :key="link.key"
          class="plan__link"
          :d="link.d"
        />
      </g>

      <g
        v-for="(node, index) in nodes"
        :key="index"
        class="plan__node"
        :style="{ '--index': index, '--weight': weight(node.data) }"
        :transform="`translate(${node.x - widthOf(node.data) / 2},${node.y})`"
      >
        <rect
          class="plan__box"
          :width="widthOf(node.data)"
          :height="NODE_HEIGHT"
          rx="8"
        />
        <text
          class="plan__label"
          x="10"
          y="14"
        >{{ node.data.label }}</text>
        <text
          v-if="node.data.detail"
          class="plan__detail"
          x="10"
          y="26"
        >
          {{ node.data.detail }}
        </text>
        <text
          v-if="node.data.cost !== undefined"
          class="plan__cost"
          :x="widthOf(node.data) - 10"
          y="14"
          text-anchor="end"
        >
          {{ format(node.data.cost) }}
        </text>
        <text
          v-if="node.data.rows !== undefined"
          class="plan__rows"
          :x="widthOf(node.data) - 10"
          y="26"
          text-anchor="end"
        >
          {{ format(node.data.rows) }} rows
        </text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.plan {
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding: var(--gap-loose);
}

.plan__svg {
  width: 100%;
  height: 100%;
  min-height: 16rem;
}

.plan__link {
  fill: none;
  stroke: color-mix(in oklab, var(--color-base-content) 22%, transparent);
  stroke-width: 1.5;
}

/*
 * The tree unfolds from the root outwards, which is the order it is read in.
 * The delay is capped so a deep plan does not take a noticeable time to settle.
 */
.plan__node {
  animation: node-in 260ms var(--ease-out) backwards;
  animation-delay: calc(min(var(--index) * 30ms, 300ms));
}

@keyframes node-in {
  from {
    opacity: 0;
  }
}

/* Cost is carried by width and by tint together, so it reads two ways. */
.plan__box {
  fill: color-mix(
    in oklab,
    var(--color-warning) calc(var(--weight) * 45%),
    var(--color-base-100)
  );
  stroke: color-mix(in oklab, var(--color-base-content) 14%, transparent);
  filter: drop-shadow(0 2px 8px oklch(0% 0 0 / 0.1));
}

.plan__label {
  fill: var(--color-base-content);
  font-size: 10px;
  font-weight: 600;
  font-family: var(--font-ui);
}

.plan__detail {
  fill: color-mix(in oklab, var(--color-base-content) 60%, transparent);
  font-size: 9px;
  font-family: var(--font-mono);
}

.plan__cost,
.plan__rows {
  fill: color-mix(in oklab, var(--color-base-content) 45%, transparent);
  font-size: 9px;
  font-family: var(--font-mono);
}

@media (prefers-reduced-motion: reduce) {
  .plan__node {
    animation: none;
  }
}
</style>
