<script setup lang="ts">
/**
 * A query plan as a tree.
 *
 * Node width is scaled to cost, so the expensive step is the wide one — the
 * thing you are looking for is the thing that stands out, without reading any
 * numbers. Hot steps are tinted toward the warning colour on the same scale.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { hierarchy, tree, type HierarchyPointNode } from 'd3-hierarchy';
import { linkVertical } from 'd3-shape';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import { maxCost, type PlanNode } from '@shared/explain';
import { textWidth } from '../../lib/columnWidths';
import ZoomControl from './ZoomControl.vue';

const props = defineProps<{ plan: PlanNode }>();

const NODE_HEIGHT = 34;
const MIN_WIDTH = 92;
const MAX_WIDTH = 380;
const LEVEL_GAP = 78;

/** The gap kept between the label on the left and the number on the right. */
const COLUMN_GAP = 14;
const SIDE_PADDING = 20;

/*
 * The fonts the text is actually set in, read from the page rather than
 * assumed, so the density scale and a larger OS text size are already in them.
 */
const fonts = computed(() => {
  void themeTick.value;
  const root = getComputedStyle(document.documentElement);
  const ui = root.getPropertyValue('--font-ui') || 'system-ui';
  const mono = root.getPropertyValue('--font-mono') || 'ui-monospace';
  return { label: `600 11px ${ui}`, detail: `9px ${mono}` };
});

/**
 * A tick to re-measure on. Nothing here changes with the theme, but the fonts
 * are read from the document and a density change rewrites them.
 */
const themeTick = ref(0);

const ceiling = computed(() => maxCost(props.plan) || 1);

/** How expensive this node is, 0 to 1, used for both width and tint. */
function weight(node: PlanNode): number {
  return Math.min((node.cost ?? 0) / ceiling.value, 1);
}

/**
 * Wide enough for the cost, and never narrower than its own words.
 *
 * Width carries cost, which is the point — the expensive step is the wide one,
 * found without reading a number. But cost and text length have nothing to do
 * with each other, and a cheap Bitmap Index Scan on a long index name is the
 * *narrowest* box with the *longest* label in it: the name ran out through the
 * right-hand edge and straight over the figures anchored there. So cost sets
 * the width it wants and the text sets the width it needs, and the box takes
 * the larger.
 */
function widthOf(node: PlanNode): number {
  const byCost = MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * weight(node);

  const face = fonts.value;
  const top =
    textWidth(node.label, face.label) +
    (node.cost === undefined ? 0 : COLUMN_GAP + textWidth(format(node.cost), face.detail));
  const bottom =
    (node.detail ? textWidth(node.detail, face.detail) : 0) +
    (node.rows === undefined
      ? 0
      : COLUMN_GAP + textWidth(`${format(node.rows)} rows`, face.detail));

  return Math.min(Math.max(byCost, Math.max(top, bottom) + SIDE_PADDING), MAX_WIDTH);
}

const layout = computed(() => {
  const root = hierarchy(props.plan, (node) => node.children as PlanNode[]);
  const build = tree<PlanNode>().nodeSize([MAX_WIDTH + 24, LEVEL_GAP]);
  return build(root);
});

const nodes = computed(() => layout.value.descendants());

/**
 * The detail line, cut to the room the box actually has.
 *
 * A box is as wide as its cost or its words, whichever is more — but there is a
 * ceiling on that, and past it a relation name simply does not fit. Clipping it
 * against the edge is what it did before, which reads as a drawing bug rather
 * than as a name too long to show; an ellipsis says the same thing on purpose,
 * and the whole name is one hover away.
 */
function detailOf(node: PlanNode): { text: string; full: string | undefined } {
  const full = node.detail ?? '';
  if (!full) return { text: '', full: undefined };

  const face = fonts.value.detail;
  const room =
    widthOf(node) -
    SIDE_PADDING -
    (node.rows === undefined ? 0 : COLUMN_GAP + textWidth(`${format(node.rows)} rows`, face));

  if (textWidth(full, face) <= room) return { text: full, full: undefined };

  let cut = full.length;
  while (cut > 1 && textWidth(`${full.slice(0, cut)}…`, face) > room) cut -= 1;
  return { text: `${full.slice(0, cut)}…`, full };
}

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

/**
 * The drawing's own size, in the units the layout was computed in.
 *
 * A diagram is not a photograph: stretched to whatever width the pane happens
 * to be, a two-node plan renders at four times the size of a twenty-node one
 * and neither is the size it was designed at. Given its natural dimensions it
 * draws at the size the node boxes were laid out for, centred, and shrinks —
 * never grows — when the pane is narrower than it is.
 */
const size = computed(() => {
  const [, , width, height] = viewBox.value.split(' ').map(Number);
  return { width: Math.round(width ?? 1), height: Math.round(height ?? 1) };
});

function format(value: number | undefined): string {
  if (value === undefined) return '';
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value * 10) / 10);
}

/* -------------------------------------------------------------------- export */

const svg = ref<SVGSVGElement>();

/**
 * The properties that carry the drawing, and the reason the export is not just
 * `outerHTML`.
 *
 * Everything here is painted from custom properties in a scoped stylesheet, and
 * a file opened anywhere else has neither. So the clone is walked and each
 * element is given the values the browser actually resolved — which is also the
 * only way to be sure the exported picture is the one that was on screen.
 */
const PAINTED = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'letter-spacing',
  'text-anchor',
] as const;

function inlineStyles(source: Element, clone: Element): void {
  const computed = getComputedStyle(source);
  const declarations = PAINTED.map((name) => `${name}:${computed.getPropertyValue(name)}`);
  clone.setAttribute('style', declarations.join(';'));

  const sourceChildren = [...source.children];
  const cloneChildren = [...clone.children];
  sourceChildren.forEach((child, index) => {
    const twin = cloneChildren[index];
    if (twin) inlineStyles(child, twin);
  });
}

/** The natural size of the drawing, from its own view box. */
function boxOf(element: SVGSVGElement): { width: number; height: number } {
  const [, , width, height] = (element.getAttribute('viewBox') ?? '0 0 0 0')
    .split(/\s+/)
    .map(Number);
  return { width: Math.max(1, width ?? 1), height: Math.max(1, height ?? 1) };
}

/**
 * The diagram as a standalone document.
 *
 * Sized in pixels as well as by view box, because a bare view box leaves the
 * size to whatever opens it — and a plan pasted into a document at the size of
 * its container is a plan nobody can read.
 */
function toSvg(): string | undefined {
  const element = svg.value;
  if (!element) return undefined;

  const clone = element.cloneNode(true) as SVGSVGElement;
  inlineStyles(element, clone);

  /*
   * The file is the plan, not the view of it. Whatever the reader has zoomed or
   * dragged to on screen is a way of looking at the drawing; exporting it would
   * write a picture of a corner of the diagram and call it the plan.
   */
  clone.querySelector('.plan__pan')?.removeAttribute('transform');

  const { width, height } = boxOf(element);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(Math.round(width)));
  clone.setAttribute('height', String(Math.round(height)));

  // On its own the drawing has nothing behind it, and a transparent PNG of pale
  // type is a picture of nothing on most surfaces it will be dropped onto.
  const backdrop = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  const [x, y] = (element.getAttribute('viewBox') ?? '0 0').split(/\s+/).map(Number);
  backdrop.setAttribute('x', String(x ?? 0));
  backdrop.setAttribute('y', String(y ?? 0));
  backdrop.setAttribute('width', String(width));
  backdrop.setAttribute('height', String(height));
  backdrop.setAttribute(
    'fill',
    getComputedStyle(element).getPropertyValue('--color-base-100').trim() || '#ffffff'
  );
  clone.insertBefore(backdrop, clone.firstChild);

  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

/** How many device pixels per drawing pixel the raster gets. */
const RASTER_SCALE = 2;

/** The same drawing, rasterised, as base64 with no data-URL prefix. */
async function toPng(): Promise<string | undefined> {
  const element = svg.value;
  const markup = toSvg();
  if (!element || !markup) return undefined;

  const { width, height } = boxOf(element);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The diagram could not be rasterised.'));
    image.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * RASTER_SCALE);
  canvas.height = Math.round(height * RASTER_SCALE);

  const context = canvas.getContext('2d');
  if (!context) return undefined;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/png').split(',')[1];
}

/* --------------------------------------------------------------- zoom & pan */

/**
 * The plan is a drawing you look *around*, not a picture that fits.
 *
 * A twelve-node plan laid out at a size its labels can be read at is wider than
 * any popup, so it was fitted into the pane instead and the labels shrank with
 * it. The pane is a viewport now: it opens at whatever fraction shows the whole
 * plan, and the zoom goes in far enough to read a relation name.
 */
const transform = ref(zoomIdentity);
let zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | undefined;

/** The height the pane takes: the drawing's own, up to a share of the window. */
const paneHeight = computed(() => `min(${size.value.height + 24}px, 58vh)`);

onMounted(() => {
  if (!svg.value) return;

  zoomBehavior = zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.3, 5])
    .on('zoom', (event) => (transform.value = event.transform));

  select(svg.value).call(zoomBehavior);
});

onBeforeUnmount(() => {
  if (svg.value) select(svg.value).on('.zoom', null);
});

function nudge(by: number): void {
  if (!svg.value || !zoomBehavior) return;
  select(svg.value).transition().duration(180).call(zoomBehavior.scaleBy, by);
}

function fit(): void {
  if (!svg.value || !zoomBehavior) return;
  select(svg.value).transition().duration(300).call(zoomBehavior.transform, zoomIdentity);
}

defineExpose({ toSvg, toPng });
</script>

<template>
  <div class="plan" :style="{ height: paneHeight }">
    <svg
      ref="svg"
      class="plan__svg"
      :viewBox="viewBox"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Query plan"
    >
      <!--
        Everything the reader can move sits under one group, so panning is one
        transform rather than a position per node — and so the export can put it
        back to nothing without touching the drawing itself.
      -->
      <g
        class="plan__pan"
        :transform="`translate(${transform.x},${transform.y}) scale(${transform.k})`"
      >
        <g>
          <path v-for="link in links" :key="link.key" class="plan__link" :d="link.d" />
        </g>

        <g
          v-for="(node, index) in nodes"
          :key="index"
          class="plan__node"
          :style="{ '--index': index, '--weight': weight(node.data) }"
          :transform="`translate(${node.x - widthOf(node.data) / 2},${node.y})`"
        >
          <rect class="plan__box" :width="widthOf(node.data)" :height="NODE_HEIGHT" rx="8" />
          <text class="plan__label" x="10" y="14">{{ node.data.label }}</text>
          <text
            v-if="node.data.detail"
            v-tip="detailOf(node.data).full"
            class="plan__detail"
            x="10"
            y="26"
          >
            {{ detailOf(node.data).text }}
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
      </g>
    </svg>

    <ZoomControl :scale="transform.k" @zoom="nudge" @fit="fit" />
  </div>
</template>

<style scoped>
.plan {
  position: relative;
  min-height: 0;
  padding: var(--gap-loose);
  /* Not clipped, for the reason given on `.erd`: the only thing it cut was the
     zoom control's shadow. The `<svg>` clips its own viewport. */
}

.plan__svg {
  width: 100%;
  height: 100%;
  cursor: grab;
  touch-action: none;
}

.plan__svg:active {
  cursor: grabbing;
}

/* The only thing that moves when the reader pans or zooms, so it is the one
   layer worth promoting: the tree is redrawn as a composite rather than as a
   repaint of every node in it. */
.plan__pan {
  will-change: transform;
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
    var(--surface-raised)
  );
  stroke: color-mix(in oklab, var(--color-base-content) 22%, transparent);
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
