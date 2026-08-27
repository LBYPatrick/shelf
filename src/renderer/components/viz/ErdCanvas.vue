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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import { drag } from 'd3-drag';
import { linkHorizontal } from 'd3-shape';
import ZoomControl from './ZoomControl.vue';

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
const frame = ref<HTMLElement>();
const nodes = shallowRef<Node[]>([]);
const links = shallowRef<Link[]>([]);
const transform = ref(zoomIdentity);
const hovered = ref<string | null>(null);
const touched = ref(false);
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

  /*
   * Repulsion, but bounded, and something pulling back.
   *
   * Charge alone has nothing to stop it: two tables with no key between them
   * push each other apart for as long as the simulation runs, and a schema is
   * mostly pairs of tables with no key between them. The layout settled tens of
   * thousands of units across — so "fit the whole diagram" honestly answered
   * nine per cent, and the reader was shown five specks and a lot of nothing.
   *
   * `distanceMax` stops a table shoving one it is nowhere near, and a weak pull
   * toward the middle on each axis gives the drift something to work against.
   * `forceCenter` cannot do that job: it re-centres the *average* every tick,
   * which slides the whole cloud back over the origin without ever making it
   * smaller.
   */
  simulation = forceSimulation(built)
    .force('charge', forceManyBody().strength(-520).distanceMax(1400))
    .force(
      'link',
      forceLink<Node, Link>(built_links)
        .id((node) => node.key)
        .distance(220)
    )
    .force('center', forceCenter(0, 0))
    .force('gravity-x', forceX(0).strength(0.045))
    // Slightly stronger down the short axis, so the cloud lands wider than it
    // is tall — which is the shape of the pane it has to fit into.
    .force('gravity-y', forceY(0).strength(0.075))
    // Collision uses the real box, so nodes settle without overlapping.
    .force(
      'collide',
      forceCollide<Node>().radius((node) => Math.hypot(node.width, node.height) / 2 + 16)
    )
    .on('tick', () => (tick.value += 1))
    /*
     * Fitted once, when the layout stops moving. Fitting on every tick would
     * make the diagram breathe while it settles, and fitting before it settles
     * frames a shape that no longer exists a second later.
     */
    .on('end', () => {
      if (!touched.value) fit(false);
    });

  // The layout runs to a resting state and stops. Leaving it running would
  // make the diagram creep while you are reading it.
  simulation.alpha(1).alphaDecay(0.03);
}

/*
 * The canvas is the size of the pane, and the zoom does the rest.
 *
 * It used to take a `viewBox` around every node, which meant the diagram's
 * *scale* was decided by how many tables there were: two hundred of them laid
 * out by a force simulation cover a canvas tens of thousands of units across,
 * and fitting that into a pane drew every table as a speck two pixels tall. The
 * zoom could not rescue it either — three times a speck is a speck. So one unit
 * is one pixel at rest, whatever the schema, and what changes with the size of
 * the schema is where the view starts.
 */
const pane = ref({ width: 800, height: 600 });
let watcher: ResizeObserver | undefined;

/** The box every node fits in, in diagram units. */
function bounds(): { x: number; y: number; width: number; height: number } | null {
  if (nodes.value.length === 0) return null;

  const xs = nodes.value.flatMap((node) => [
    (node.x ?? 0) - node.width / 2,
    (node.x ?? 0) + node.width / 2,
  ]);
  const ys = nodes.value.flatMap((node) => [
    (node.y ?? 0) - node.height / 2,
    (node.y ?? 0) + node.height / 2,
  ]);

  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

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

  /*
   * Wide enough at the bottom to hold a two-hundred-table schema in view, and
   * far enough at the top to read a column name at arm's length. The old range
   * stopped at three, which was three times too small to read whenever the
   * diagram had been shrunk to fit in the first place.
   */
  zoomBehavior = zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.05, 4])
    .on('zoom', (event) => {
      // A gesture has a source event behind it; our own `fit` does not. Once
      // the reader has moved the view it is theirs, and the layout settling a
      // second later must not take it back.
      if (event.sourceEvent) touched.value = true;
      transform.value = event.transform;
    });

  element.call(zoomBehavior);

  watcher = new ResizeObserver(([entry]) => {
    if (!entry) return;
    pane.value = { width: entry.contentRect.width, height: entry.contentRect.height };
  });
  if (frame.value) watcher.observe(frame.value);

  bindDrag();
});

/*
 * Bound after every rebuild, not once at mount.
 *
 * The nodes are drawn by Vue from `nodes`, so at the moment this component
 * mounts there is nothing under the SVG to select — the handlers went onto an
 * empty selection and no table could be moved.
 */
function bindDrag(): void {
  if (!svg.value) return;
  const element = select(svg.value);

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
}

watch(() => [props.tables, props.edges], build, { deep: false });

watch(nodes, () => void nextTick(bindDrag));

onBeforeUnmount(() => {
  simulation?.stop();
  watcher?.disconnect();
});

/**
 * Puts the whole diagram in view, whatever size it turned out to be.
 *
 * `zoomIdentity` was what this used to do, which only ever meant "put it back
 * where the browser had it" — and where the browser had it depended on a
 * `viewBox` that had already shrunk the drawing to nothing.
 */
function fit(animate = true): void {
  if (!svg.value || !zoomBehavior) return;

  const box = bounds();
  if (!box || box.width === 0 || box.height === 0) return;

  const padding = 48;
  const scale = Math.min(
    (pane.value.width - padding * 2) / box.width,
    (pane.value.height - padding * 2) / box.height,
    1
  );
  const next = zoomIdentity
    .translate(
      pane.value.width / 2 - (box.x + box.width / 2) * scale,
      pane.value.height / 2 - (box.y + box.height / 2) * scale
    )
    .scale(scale);

  const target = select(svg.value);
  if (animate) target.transition().duration(400).call(zoomBehavior.transform, next);
  else target.call(zoomBehavior.transform, next);
}

function nudge(by: number): void {
  if (!svg.value || !zoomBehavior) return;
  touched.value = true;
  select(svg.value).transition().duration(180).call(zoomBehavior.scaleBy, by);
}

defineExpose({ fit });
</script>

<template>
  <div ref="frame" class="erd">
    <svg ref="svg" class="erd__svg" role="img" aria-label="Entity relationship diagram">
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
          <rect class="erd-node__box" :width="node.width" :height="node.height" rx="10" />
          <rect class="erd-node__header" :width="node.width" :height="HEADER_HEIGHT" rx="10" />
          <text class="erd-node__title" x="10" :y="HEADER_HEIGHT / 2 + 4">
            {{ node.name }}
          </text>

          <g v-for="(column, index) in node.columns.slice(0, MAX_ROWS)" :key="column.name">
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

    <ZoomControl :scale="transform.k" @zoom="nudge" @fit="fit()" />
  </div>
</template>

<style scoped>
.erd {
  position: relative;
  /*
   * The same recessed field the query editor sits in. The diagram is content
   * inside the working pane, not the pane itself, and giving it the pane's own
   * colour left the node boxes with nothing to stand on.
   */
  background: var(--fill-4);
  height: 100%;
  min-height: 0;
  /*
   * Not clipped here.
   *
   * It used to be, and the only thing that clip ever cut was the zoom control's
   * own shadow: the diagram is drawn inside an outermost `<svg>`, which clips
   * to its own viewport by specification, so a pan that carries a node off the
   * edge is already contained without help. The control floats a gap in from
   * the corner, and an elevation shadow is wider than the gap — so it was
   * sliced flat along two edges, which is the one thing a shadow must never
   * be, because a shadow with a straight cut in it reads as a seam in the
   * surface rather than as depth.
   */
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

/*
 * Contrast, throughout.
 *
 * Every value here was a fraction of the text colour low enough that the
 * diagram read as a watermark: lines at thirty per cent over a translucent pane
 * are a suggestion of a line, and the boxes they join were themselves
 * translucent. The drawing is the content of this pane, so it is drawn at the
 * weight content is drawn at, and only the *dimming* of what you are not
 * pointing at is faint.
 */
.erd__edge {
  fill: none;
  stroke: color-mix(in oklab, var(--color-base-content) 46%, transparent);
  stroke-width: 1.75;
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
  fill: var(--surface-raised);
  stroke: color-mix(in oklab, var(--color-base-content) 24%, transparent);
  filter: drop-shadow(0 4px 14px oklch(0% 0 0 / 0.12));
}

.erd-node__header {
  fill: color-mix(in oklab, var(--color-primary) 24%, transparent);
}

.erd-node__title {
  fill: var(--color-base-content);
  font-size: 12px;
  font-weight: 600;
  font-family: var(--font-ui);
}

.erd-node__column {
  fill: color-mix(in oklab, var(--color-base-content) 92%, transparent);
  font-size: 11px;
  font-family: var(--font-mono);
}

.erd-node__column--key {
  fill: var(--color-primary-text, var(--color-primary));
  font-weight: 600;
}

.erd-node__type {
  fill: color-mix(in oklab, var(--color-base-content) 60%, transparent);
  font-size: 10px;
  font-family: var(--font-mono);
}

.erd-node__more {
  fill: color-mix(in oklab, var(--color-base-content) 60%, transparent);
  font-size: 10px;
  font-style: italic;
}

@media (prefers-reduced-motion: reduce) {
  .erd__edge,
  .erd-node {
    transition: none;
  }
}
</style>
