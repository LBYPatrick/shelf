<script setup lang="ts">
/**
 * The tab strip.
 *
 * Tabs reorder by dragging one-to-one with the pointer: the dragged tab follows
 * the finger exactly while its neighbours spring aside, so the reorder reads as
 * moving a physical thing rather than as a list re-sorting itself.
 */
import { ref } from 'vue';
import { useTabs, type Tab } from '../../stores/tabs';
import { useDrag } from '../../composables/useDrag';

const tabs = useTabs();

const dragIndex = ref<number | null>(null);
const dragOffset = ref(0);
const stripEl = ref<HTMLElement>();

/** Measured on grab so a density change never desyncs the reorder maths. */
let tabWidth = 160;

const { start } = useDrag({
  axis: 'x',
  getValue: () => 0,
  onDrag: ({ value }) => {
    dragOffset.value = value;

    if (dragIndex.value === null) return;
    const shift = Math.round(value / tabWidth);
    const target = dragIndex.value + shift;
    if (shift === 0 || target < 0 || target >= tabs.tabs.length) return;

    tabs.move(dragIndex.value, target);
    dragIndex.value = target;
    // Re-anchor so the tab stays under the pointer after the list shifted.
    dragOffset.value = value - shift * tabWidth;
  },
  onRelease: () => {
    dragIndex.value = null;
    dragOffset.value = 0;
  },
});

function beginDrag(event: PointerEvent, index: number): void {
  const element = (event.currentTarget as HTMLElement).getBoundingClientRect();
  tabWidth = element.width || tabWidth;
  dragIndex.value = index;
  start(event);
}

function onAuxClick(event: MouseEvent, tab: Tab): void {
  // Middle click closes, which is the convention everywhere tabs exist.
  if (event.button === 1) {
    event.preventDefault();
    tabs.close(tab.id);
  }
}

const KIND_MARK: Record<Tab['kind'], string> = {
  table: '▤',
  query: '›_',
  structure: '⚙',
  erd: '◇',
};
</script>

<template>
  <div
    ref="stripEl"
    class="strip mat-regular"
  >
    <!--
      The tablist holds tabs and nothing else. The new-tab button used to sit
      inside it, which makes assistive technology announce a control that is not
      one of the tabs as though it were one.
    -->
    <div
      class="strip__tabs"
      role="tablist"
    >
      <div
        v-for="(tab, index) in tabs.tabs"
        :key="tab.id"
        class="striptab"
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
        <span
          class="striptab__mark"
          aria-hidden="true"
        >{{ KIND_MARK[tab.kind] }}</span>
        <span class="striptab__title">{{ tab.title }}</span>
        <span
          v-if="tab.subtitle"
          class="striptab__scope"
        >{{ tab.subtitle }}</span>
        <button
          class="striptab__close"
          :aria-label="`Close ${tab.title}`"
          @pointerdown.stop
          @click.stop="tabs.close(tab.id)"
        >
          {{ tab.unsaved ? '•' : '✕' }}
        </button>
      </div>
    </div>

    <button
      class="strip__new"
      aria-label="New query tab"
      @click="tabs.openQuery()"
    >
      ＋
    </button>
  </div>
</template>

<style scoped>
/*
 * A recessed track holding raised tabs — the same relationship the segmented
 * control has between its track and its thumb, because it is the same idea.
 * The strip used to be flush with the content and marked the active tab with a
 * coloured rule across its top, which is the one shape in the window that was
 * neither rounded nor tonal.
 */
.strip {
  display: flex;
  align-items: center;
  gap: 2px;
  height: var(--tab-h);
  padding: var(--gap-hair) var(--gap-tight);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  background-color: var(--fill-4);
}

/* The tabs themselves; the strip around them is what scrolls. */
.strip__tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.strip::-webkit-scrollbar {
  display: none;
}

.striptab {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  flex: 0 0 auto;
  height: calc(var(--tab-h) - var(--gap-tight));
  max-width: 14rem;
  padding-inline: var(--gap) var(--gap-hair);
  border-radius: calc(var(--control-radius) - 1px);
  font-size: 0.75rem;
  color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
  touch-action: none;
  transition:
    background-color 140ms ease-out,
    box-shadow 140ms ease-out,
    color 140ms ease-out;
}

.striptab:hover {
  background: color-mix(in oklab, var(--color-base-content) 5%, transparent);
}

/*
 * Raised, not underlined. A coloured rule across the top edge was the one shape
 * in the window that was neither rounded nor tonal; the surface says which tab
 * is open, exactly as the segmented control's thumb does.
 */
.tab--on {
  background-color: var(--control-thumb);
  box-shadow: var(--elev-thumb);
  color: var(--color-base-content);
}

.tab--dragging {
  z-index: 2;
  background-color: var(--control-thumb);
  box-shadow: 0 4px 16px oklch(0% 0 0 / 0.18);
  transition: none;
}

.striptab__mark {
  font-size: 0.625rem;
  opacity: 0.65;
}

.striptab__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.striptab__scope {
  font-size: 0.625rem;
  opacity: 0.45;
}

.striptab__close {
  display: grid;
  place-items: center;
  width: 1.125rem;
  height: 1.125rem;
  border-radius: 0.25rem;
  font-size: 0.625rem;
  opacity: 0;
  transition:
    opacity 120ms ease-out,
    background-color 120ms ease-out;
}

.striptab:hover .striptab__close,
.tab--on .striptab__close,
.striptab__close:focus-visible {
  opacity: 0.7;
}

.striptab__close:hover {
  opacity: 1;
  background: color-mix(in oklab, var(--color-base-content) 12%, transparent);
}

/* Sized like a tab, because it sits in the same row as one. */
.strip__new {
  flex: 0 0 auto;
  width: 2rem;
  min-width: var(--hit-min);
  height: calc(var(--tab-h) - var(--gap-tight));
  border-radius: calc(var(--control-radius) - 1px);
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
}

.strip__new:hover {
  background: color-mix(in oklab, var(--color-base-content) 6%, transparent);
  color: var(--color-base-content);
}
</style>
