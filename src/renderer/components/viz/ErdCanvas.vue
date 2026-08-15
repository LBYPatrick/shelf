<script setup lang="ts">
/**
 * The entity-relationship diagram.
 *
 * A force simulation finds an initial arrangement, then stops. Positions are
 * kept afterwards rather than left to the simulation, because a diagram that
 * drifts every time you look at it is one you can never learn the shape of —
 * spatial memory is most of what a diagram is for.
 *
 * Drawn as themed SVG so it re-colours with the accent and the light/dark mode
 * along with everything else.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import { drag } from 'd3-drag';
import { linkHorizontal } from 'd3-shape';

export interface ErdTable {
  readonly key: string;
  readonly name: string;
  readonly schema?: string;
  readonly columns: readonly { name: string; dataType: string; primaryKey: boolean }[];
}

export interface ErdEdge {
  readonly source: string;
  readonly target: string;
  readonly label: string;
}

interface Node extends SimulationNodeDatum {
  key: string;
  name: string;
  schema?: string;
  columns: ErdTable['columns'];
  width: number;
  height: number;
}

type Link = SimulationLinkDatum<Node> & { label: string };

const props = defineProps<{ tables: readonly ErdTable[]; edges: readonly ErdEdge[] }>();
const emit = defineEmits<{ openTable: [string] }>();

const svg = ref<SVGSVGElement>();
const nodes = shallowRef<Node[]>([]);
const links = shallowRef<Link[]>([]);
const transform = ref(zoomIdentity);
const hovered = ref<string | null>(null);
const tick = ref(0);

let simulation: Simulation<Node, Link> | undefined;
let zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | undefined;

/** Node size follows content: a wide table should look wide. */
const HEADER_HEIGHT = 26;
const ROW_HEIGHT = 18;
const MAX_ROWS = 12;

function measure(table: ErdTable): { width: number; height: number } {
  const longest = table.columns.reduce(
    (widest, column) => Math.max(widest, column.name.length + column.dataType.length + 4),
    table.name.length + 2
  );

  return {
    width: Math.min(Math.max(longest * 6.4, 120), 260),
    height: HEADER_HEIGHT + Math.min(table.columns.length, MAX_ROWS) * ROW_HEIGHT + 6,
  };
}

function build(): void {
  simulation?.stop();

  // Positions are carried across a rebuild so adding one table does not
  // rearrange the whole diagram.
  const previous = new Map(nodes.value.map((node) => [node.key, node]));

  const built: Node[] = props.tables.map((table) => {
    const size = measure(table);
    const existing = previous.get(table.key);
    return {
      key: table.key,
      name: table.name,
      ...(table.schema ? { schema: table.schema } : {}),
      columns: table.columns,
      ...size,
      x: existing?.x ?? 0,
      y: existing?.y ?? 0,
    };
  });

  const byKey = new Map(built.map((node) => [node.key, node]));
  const built_links: Link[] = props.edges
    .filter((edge) => byKey.has(edge.source) && byKey.has(edge.target))
    .map((edge) => ({
      source: byKey.get(edge.source)!,
      target: byKey.get(edge.target)!,
      label: edge.label,
    }));

  nodes.value = built;
  links.value = built_links;

  simulation = forceSimulation(built)
    .force('charge', forceManyBody().strength(-900))
    .force(
      'link',
      forceLink<Node, Link>(built_links)
        .id((node) => node.key)
        .distance(220)
    )
    .force('center', forceCenter(0, 0))
    // Collision uses the real box, so nodes settle without overlapping.
    .force(
      'collide',
      forceCollide<Node>().radius((node) => Math.hypot(node.width, node.height) / 2 + 16)
    )
    .on('tick', () => (tick.value += 1));

  // The layout runs to a resting state and stops. Leaving it running would
  // make the diagram creep while you are reading it.
  simulation.alpha(1).alphaDecay(0.03);
}

const viewBox = computed(() => {
  void tick.value;
  if (nodes.value.length === 0) return '-400 -300 800 600';

  const xs = nodes.value.flatMap((node) => [
    (node.x ?? 0) - node.width / 2,
    (node.x ?? 0) + node.width / 2,
  ]);
  const ys = nodes.value.flatMap((node) => [
    (node.y ?? 0) - node.height / 2,
    (node.y ?? 0) + node.height / 2,
  ]);

  const padding = 60;
  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding;

  return `${minX} ${minY} ${Math.max(...xs) - minX + padding} ${Math.max(...ys) - minY + padding}`;
});

const curve = linkHorizontal<
  { source: [number, number]; target: [number, number] },
  [number, number]
>()
  .source((d) => d.source)
  .target((d) => d.target);

const edgePaths = computed(() => {
  void tick.value;
  return links.value.map((link) => {
    const source = link.source as Node;
    const target = link.target as Node;
    return {
      key: `${source.key}->${target.key}-${link.label}`,
      d:
        curve({
          source: [source.x ?? 0, source.y ?? 0],
          target: [target.x ?? 0, target.y ?? 0],
        }) ?? '',
      source: source.key,
      target: target.key,
    };
  });
});

/** A node is dimmed when something else is hovered and it is not related. */
function related(key: string): boolean {
  if (!hovered.value) return true;
  if (hovered.value === key) return true;
  return links.value.some((link) => {
    const source = (link.source as Node).key;
    const target = (link.target as Node).key;
    return (
      (source === hovered.value && target === key) ||
      (target === hovered.value && source === key)
    );
  });
}

onMounted(() => {
  build();

  if (!svg.value) return;
  const element = select(svg.value);

  zoomBehavior = zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.2, 3])
    .on('zoom', (event) => (transform.value = event.transform));

  element.call(zoomBehavior);

  // Node dragging pins the node where it is dropped, which is what makes the
  // arrangement yours rather than the simulation's.
  element.selectAll<SVGGElement, Node>('.erd-node').call(
    drag<SVGGElement, Node>()
      .on('start', (event, node) => {
        simulation?.alphaTarget(0.15).restart();
        node.fx = node.x;
        node.fy = node.y;
        void event;
      })
      .on('drag', (event, node) => {
        node.fx = event.x;
        node.fy = event.y;
      })
      .on('end', (_event, node) => {
        simulation?.alphaTarget(0);
        // fx/fy are deliberately kept so the node stays put.
        node.fx = node.x ?? null;
        node.fy = node.y ?? null;
      })
  );
});

watch(() => [props.tables, props.edges], build, { deep: false });

onBeforeUnmount(() => simulation?.stop());

function fit(): void {
  if (!svg.value || !zoomBehavior) return;
  select(svg.value).transition().duration(400).call(zoomBehavior.transform, zoomIdentity);
}

defineExpose({ fit });
</script>

<template>
  <div class="erd">
    <svg
      ref="svg"
      class="erd__svg"
      :viewBox="viewBox"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Entity relationship diagram"
    >
      <g :transform="`translate(${transform.x},${transform.y}) scale(${transform.k})`">
        <!-- Grouped so the whole set transforms together with the canvas. -->
        <g>
          <path
            v-for="edge in edgePaths"
            :key="edge.key"
            class="erd__edge"
            :class="{
              'erd__edge--dim': hovered && edge.source !== hovered && edge.target !== hovered,
            }"
            :d="edge.d"
          />
        </g>

        <g
          v-for="node in nodes"
          :key="node.key"
          class="erd-node"
          :class="{ 'erd-node--dim': !related(node.key) }"
          :transform="`translate(${(node.x ?? 0) - node.width / 2},${(node.y ?? 0) - node.height / 2})`"
          @mouseenter="hovered = node.key"
          @mouseleave="hovered = null"
          @dblclick="emit('openTable', node.key)"
        >
          <rect
            class="erd-node__box"
            :width="node.width"
            :height="node.height"
            rx="10"
          />
          <rect
            class="erd-node__header"
            :width="node.width"
            :height="HEADER_HEIGHT"
            rx="10"
          />
          <text
            class="erd-node__title"
            x="10"
            :y="HEADER_HEIGHT / 2 + 4"
          >
            {{ node.name }}
          </text>

          <g
            v-for="(column, index) in node.columns.slice(0, MAX_ROWS)"
            :key="column.name"
          >
            <text
              class="erd-node__column"
              :class="{ 'erd-node__column--key': column.primaryKey }"
              x="10"
              :y="HEADER_HEIGHT + index * ROW_HEIGHT + 13"
            >
              {{ column.primaryKey ? '◆ ' : '' }}{{ column.name }}
            </text>
            <text
              class="erd-node__type"
              :x="node.width - 10"
              :y="HEADER_HEIGHT + index * ROW_HEIGHT + 13"
              text-anchor="end"
            >
              {{ column.dataType }}
            </text>
          </g>

          <text
            v-if="node.columns.length > MAX_ROWS"
            class="erd-node__more"
            x="10"
            :y="HEADER_HEIGHT + MAX_ROWS * ROW_HEIGHT + 12"
          >
            +{{ node.columns.length - MAX_ROWS }} more
          </text>
        </g>
      </g>
    </svg>

    <button
      class="erd__fit"
      @click="fit"
    >
      Reset view
    </button>
  </div>
</template>

<style scoped>
.erd {
  position: relative;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.erd__svg {
  width: 100%;
  height: 100%;
  cursor: grab;
  touch-action: none;
}

.erd__svg:active {
  cursor: grabbing;
}

.erd__edge {
  fill: none;
  stroke: color-mix(in oklab, var(--color-base-content) 30%, transparent);
  stroke-width: 1.5;
  transition:
    opacity 200ms ease-out,
    stroke 200ms ease-out;
}

.erd__edge--dim {
  opacity: 0.12;
}

.erd-node {
  cursor: default;
  transition: opacity 200ms ease-out;
}

.erd-node--dim {
  opacity: 0.24;
}

.erd-node__box {
  fill: color-mix(in oklab, var(--color-base-100) 92%, transparent);
  stroke: color-mix(in oklab, var(--color-base-content) 14%, transparent);
  filter: drop-shadow(0 4px 14px oklch(0% 0 0 / 0.12));
}

.erd-node__header {
  fill: color-mix(in oklab, var(--color-primary) 16%, transparent);
}

.erd-node__title {
  fill: var(--color-base-content);
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-ui);
}

.erd-node__column {
  fill: color-mix(in oklab, var(--color-base-content) 82%, transparent);
  font-size: 10px;
  font-family: var(--font-mono);
}

.erd-node__column--key {
  fill: var(--color-primary);
}

.erd-node__type {
  fill: color-mix(in oklab, var(--color-base-content) 42%, transparent);
  font-size: 9px;
  font-family: var(--font-mono);
}

.erd-node__more {
  fill: color-mix(in oklab, var(--color-base-content) 42%, transparent);
  font-size: 9px;
  font-style: italic;
}

.erd__fit {
  position: absolute;
  right: var(--gap);
  bottom: var(--gap);
  padding: var(--gap-tight) var(--gap);
  border-radius: var(--radius-field);
  border: 1px solid var(--separator);
  background: color-mix(in oklab, var(--color-base-100) 78%, transparent);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  font-size: 0.6875rem;
}

@media (prefers-reduced-motion: reduce) {
  .erd__edge,
  .erd-node {
    transition: none;
  }
}
</style>
