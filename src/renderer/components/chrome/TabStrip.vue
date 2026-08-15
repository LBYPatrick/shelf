<script setup lang="ts">
/**
 * The tab strip.
 *
 * One selection that travels, rather than a surface each tab paints for itself.
 * That is what makes a row of tabs read as positions on one axis instead of as
 * several controls that happen to be adjacent — the same reason the rail moves
 * its marker rather than blinking it on and off.
 *
 * It also removes the shape that was wrong. The open tab used to be the raised
 * white thumb of a segmented control, and a raised thumb needs the recessed
 * track it is raised *out of* to be legible as raised. The strip is a region of
 * the top bar now, and the bar may not carry a tint of its own — so there is no
 * track, and a thumb with no track is a card hovering over nothing. Loudness
 * carries the difference instead: quiet by default, a tonal surface for the one
 * that is open.
 *
 * Tabs reorder by dragging one-to-one with the pointer: the dragged tab follows
 * the finger exactly while its neighbours spring aside, so the reorder reads as
 * moving a physical thing rather than as a list re-sorting itself.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useTabs, type Tab } from '../../stores/tabs';
import { useDrag } from '../../composables/useDrag';
import AppIcon from '../ui/AppIcon.vue';

const tabs = useTabs();

/**
 * Which tab the pointer went down on, and where it has carried it.
 *
 * Whether a drag is *happening* is `useDrag`'s to say, not this component's.
 * Holding a second copy of that here is what left a tab lifted after a plain
 * click: a press that never crosses the movement threshold is not a drag, so
 * the release hook is never called, so the index this file set on pointerdown
 * was never cleared. Derived from `dragging`, there is no second copy to fall
 * out of step.
 */
const heldIndex = ref<number | null>(null);
const dragOffset = ref(0);
const stripEl = ref<HTMLElement>();
const listEl = ref<HTMLElement>();

/** Measured on grab so a density change never desyncs the reorder maths. */
let tabWidth = 160;

/**
 * Where the selection sits, in the list's own coordinates.
 *
 * Measured rather than stepped, because tabs are as wide as their titles. The
 * rail can multiply an index by a row height; this cannot.
 */
const marker = ref<{ x: number; width: number } | null>(null);

function measure(): void {
  // By class, not by index: the marker is itself a child of the list, so
  // counting positions would be off by one for as long as it is on screen.
  const list = listEl.value;
  const index = tabs.tabs.findIndex((tab) => tab.id === tabs.activeId);
  const element = list?.querySelectorAll<HTMLElement>('.striptab')[index];

  if (!list || !element) {
    marker.value = null;
    return;
  }

  // Measured, not offset: `offsetLeft` and `offsetWidth` round to whole pixels,
  // so the marker sat up to half a pixel out from the tab it is meant to be.
  const box = element.getBoundingClientRect();
  marker.value = { x: box.left - list.getBoundingClientRect().left, width: box.width };
}

/**
 * The marker follows the tab being dragged rather than staying where the tab
 * used to be — it is the same object, and one of them arriving late would say
 * the selection and the tab are two things.
 */
const markerStyle = computed(() => {
  const at = marker.value;
  if (!at) return undefined;

  const activeIndex = tabs.tabs.findIndex((tab) => tab.id === tabs.activeId);
  const held = dragIndex.value !== null && dragIndex.value === activeIndex;

  return {
    transform: `translateX(${at.x + (held ? dragOffset.value : 0)}px)`,
    width: `${at.width}px`,
  };
});

const { start, dragging } = useDrag({
  axis: 'x',
  getValue: () => 0,
  onDrag: ({ value }) => {
    dragOffset.value = value;

    if (heldIndex.value === null) return;
    const shift = Math.round(value / tabWidth);
    const target = heldIndex.value + shift;
    if (shift === 0 || target < 0 || target >= tabs.tabs.length) return;

    tabs.move(heldIndex.value, target);
    heldIndex.value = target;
    // Re-anchor so the tab stays under the pointer after the list shifted.
    dragOffset.value = value - shift * tabWidth;
  },
  onRelease: () => {
    heldIndex.value = null;
    dragOffset.value = 0;
    void nextTick(measure);
  },
});

const dragIndex = computed(() => (dragging.value ? heldIndex.value : null));

function beginDrag(event: PointerEvent, index: number): void {
  const element = (event.currentTarget as HTMLElement).getBoundingClientRect();
  tabWidth = element.width || tabWidth;
  heldIndex.value = index;
  dragOffset.value = 0;
  start(event);
}

function onAuxClick(event: MouseEvent, tab: Tab): void {
  // Middle click closes, which is the convention everywhere tabs exist.
  if (event.button === 1) {
    event.preventDefault();
    tabs.close(tab.id);
  }
}

/*
 * A title changing length, the density scale changing, or the UI font arriving
 * all move the tabs without the list itself changing. Watching the store would
 * miss every one of them.
 */
let observer: ResizeObserver | undefined;

onMounted(() => {
  observer = new ResizeObserver(measure);
  if (listEl.value) observer.observe(listEl.value);
  measure();
});

onBeforeUnmount(() => observer?.disconnect());

watch(
  [() => tabs.activeId, () => tabs.tabs.length, () => dragIndex.value],
  () => void nextTick(measure),
  { flush: 'post' }
);

const KIND_ICON: Record<Tab['kind'], string> = {
  table: 'table',
  query: 'query',
  erd: 'diagram',
};
</script>

<template>
  <div
    ref="stripEl"
    class="strip drag-region"
  >
    <!--
      The tablist holds tabs and nothing else. The new-tab button used to sit
      inside it, which makes assistive technology announce a control that is not
      one of the tabs as though it were one.
    -->
    <div
      ref="listEl"
      class="strip__tabs"
      role="tablist"
    >
      <span
        v-if="marker"
        class="strip__marker"
        :class="{ 'strip__marker--held': dragIndex !== null }"
        :style="markerStyle"
        aria-hidden="true"
      />

      <div
        v-for="(tab, index) in tabs.tabs"
        :key="tab.id"
        class="striptab no-drag"
        :class="{
          'striptab--on': tab.id === tabs.activeId,
          'striptab--dragging': dragIndex === index,
        }"
        :style="dragIndex === index ? { transform: `translateX(${dragOffset}px)` } : undefined"
        role="tab"
        :aria-selected="tab.id === tabs.activeId"
        tabindex="0"
        @pointerdown="
          tabs.focus(tab.id);
          beginDrag($event, index);
        "
        @auxclick="onAuxClick($event, tab)"
        @keydown.delete="tabs.close(tab.id)"
      >
        <AppIcon
          class="striptab__mark"
          :name="KIND_ICON[tab.kind]"
          :size="12"
        />
        <span class="striptab__title">{{ tab.title }}</span>
        <span
          v-if="tab.subtitle"
          class="striptab__scope"
        >{{ tab.subtitle }}</span>

        <!--
          The dot is the unsaved mark and the cross is the action, in one place
          because they are one place on every other tabbed interface: the mark
          you are looking at is the target you are already aiming for.
        -->
        <button
          class="striptab__close"
          :class="{ 'striptab__close--unsaved': tab.unsaved }"
          :aria-label="`Close ${tab.title}`"
          @pointerdown.stop
          @click.stop="tabs.close(tab.id)"
        >
          <span
            v-if="tab.unsaved"
            class="striptab__dot"
            aria-hidden="true"
          />
          <AppIcon
            class="striptab__cross"
            name="close"
            :size="9"
          />
        </button>
      </div>
    </div>

    <button
      class="strip__new no-drag"
      aria-label="New query tab"
      @click="tabs.openQuery()"
    >
      <AppIcon
        name="plus"
        :size="13"
      />
    </button>
  </div>
</template>

<style scoped>
/*
 * The strip is a drag surface, and the tabs on it are not.
 *
 * Everything along the window's top edge that is not itself a control should
 * move the window — that is where the hand goes. The tabs opt out because they
 * are draggable in their own right, for reordering.
 *
 * No surface of its own either. The strip is a region of the top bar, not a
 * band inside the content pane, and the bar is the material — a tint here would
 * be a second shade drawn across part of one bar, which is exactly the line
 * under the window controls that the bar exists to remove.
 */
.strip {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--gap-tight);
  min-width: 0;
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

/* The tabs themselves; the strip around them is what scrolls. */
.strip__tabs {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  min-width: 0;
  height: 100%;
}

.strip::-webkit-scrollbar {
  display: none;
}

/*
 * Tonal and flush, not raised. The hairline is what gives the shape an edge
 * against glass — a fill alone on a translucent bar reads as a smudge, because
 * the bar is already carrying whatever is behind the window.
 */
.strip__marker {
  position: absolute;
  top: 50%;
  left: 0;
  height: calc(var(--tab-h) - var(--gap));
  margin-top: calc((var(--tab-h) - var(--gap)) / -2);
  border-radius: var(--control-radius);
  background: var(--fill-3);
  box-shadow: inset 0 0 0 1px var(--separator);
  transition:
    transform var(--t-pop) var(--ease-out),
    width var(--t-pop) var(--ease-out);
}

/* Held, it is the same object as the tab and must not arrive after it. */
.strip__marker--held {
  transition: none;
}

@media (prefers-reduced-motion: reduce) {
  .strip__marker {
    transition: none;
  }
}

.striptab {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  flex: 0 0 auto;
  height: calc(var(--tab-h) - var(--gap));
  max-width: 16rem;
  padding-inline: var(--gap) var(--gap-tight);
  border-radius: var(--control-radius);
  font-size: 0.75rem;
  color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
  touch-action: none;
  transition: color var(--t-hover) var(--ease-out);
}

/*
 * Only the ones the marker is not already under. Hovering the open tab would
 * put a second surface over the one that says it is open, and two highlights
 * for one state only line up while nothing moves.
 */
.striptab:not(.striptab--on):hover {
  background: var(--fill-4);
  color: var(--color-base-content);
}

.striptab--on {
  color: var(--color-base-content);
  /*
   * Weight, not size. It is the one axis that adds presence without changing
   * how much room the tab takes — and the marker is measured from that room,
   * so a tab that grew on selection would drag the marker along behind it.
   */
  font-weight: 550;
}

/*
 * Lifted only while held. This is the one moment elevation is honest: the tab
 * is genuinely off the row, following the pointer, and the shadow is what says
 * so. The marker underneath drops its transition to stay with it.
 */
.striptab--dragging {
  z-index: 2;
  background-color: var(--control-thumb);
  box-shadow: var(--elev-popover);
  transition: none;
}

.striptab__mark {
  flex: 0 0 auto;
  opacity: 0.55;
}

.striptab--on .striptab__mark {
  opacity: 0.8;
}

.striptab__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.striptab__scope {
  flex: 0 0 auto;
  font-size: 0.625rem;
  opacity: 0.45;
}

.striptab__close {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 1.125rem;
  height: 1.125rem;
  border-radius: 0.25rem;
  color: inherit;
  opacity: 0;
  transition:
    opacity var(--t-hover) var(--ease-out),
    background-color var(--t-press) var(--ease-out);
}

/*
 * The two marks occupy the same cell and swap. An unsaved tab shows its dot
 * until the pointer is over the button, and then shows what pressing it does.
 */
.striptab__dot,
.striptab__cross {
  grid-area: 1 / 1;
}

.striptab__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
}

.striptab__close--unsaved {
  opacity: 0.75;
}

.striptab__close--unsaved .striptab__cross {
  opacity: 0;
}

.striptab:hover .striptab__close,
.striptab--on .striptab__close,
.striptab__close:focus-visible {
  opacity: 0.6;
}

.striptab__close:hover,
.striptab__close--unsaved:hover {
  opacity: 1;
  background: var(--fill-2);
}

.striptab__close:hover .striptab__dot {
  opacity: 0;
}

.striptab__close:hover .striptab__cross {
  opacity: 1;
}

/* Sized like a tab, because it sits in the same row as one. */
.strip__new {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: var(--hit-min);
  height: calc(var(--tab-h) - var(--gap));
  border-radius: var(--control-radius);
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
  transition:
    background-color var(--t-hover) var(--ease-out),
    color var(--t-hover) var(--ease-out),
    transform var(--t-press) var(--ease-out);
}

.strip__new:hover {
  background: var(--fill-4);
  color: var(--color-base-content);
}

.strip__new:active {
  transform: scale(0.92);
}
</style>
