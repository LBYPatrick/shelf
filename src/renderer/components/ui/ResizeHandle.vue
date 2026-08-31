<script setup lang="ts">
/**
 * The divider between two panes.
 *
 * It tracks the pointer one-to-one and resists at its limits instead of
 * stopping dead, so dragging a sidebar to its minimum feels like reaching the
 * end of something physical rather than hitting a bug. It draws nothing until
 * the pointer is on it: the panes meet directly, and the handle is a target
 * straddling that meeting rather than a rule drawn between them.
 */
import { computed } from 'vue';
import { useDrag } from '../../composables/useDrag';

const props = withDefaults(
  defineProps<{
    /** Current size of the pane this handle controls, in px. */
    size: number;
    min: number;
    max: number;
    orientation?: 'vertical' | 'horizontal';
    /** True when the handle sits on the pane's leading edge, so it grows backwards. */
    invert?: boolean;
    ariaLabel: string;
  }>(),
  { orientation: 'vertical', invert: false }
);

/**
 * `reset`, rather than the size being reset here.
 *
 * A double click on a divider means "put it back" everywhere it means anything,
 * and the handle cannot know what back is: the sidebar's default is a number
 * and the query editor's is a share of the pane it is in. So it reports the
 * gesture and the owner answers it.
 *
 * It used to emit `collapse-toggle`, which the sidebar answered by collapsing —
 * a one-way door, since a collapsed sidebar hides the handle that shut it and
 * the only way back was the keyboard. A toggle that only ever goes one way is
 * not a toggle.
 */
const emit = defineEmits<{ 'update:size': [number]; reset: [] }>();

const axis = computed(() => (props.orientation === 'vertical' ? 'x' : 'y'));

const { start, dragging } = useDrag({
  axis: axis.value,
  invert: props.invert,
  getValue: () => props.size,
  bounds: () => ({ min: props.min, max: props.max }),
  extent: () => props.max - props.min,
  onDrag: ({ value }) => emit('update:size', value),
  // Snap back inside the limits when the pointer is released past them.
  onRelease: ({ value }) =>
    emit('update:size', Math.min(props.max, Math.max(props.min, value))),
});

/** Keyboard resizing, because a drag-only control is unreachable without a mouse. */
function nudge(delta: number): void {
  emit('update:size', Math.min(props.max, Math.max(props.min, props.size + delta)));
}
</script>

<template>
  <div
    class="handle"
    :class="[`handle--${orientation}`, { 'handle--dragging': dragging }]"
    role="separator"
    tabindex="0"
    :aria-label="ariaLabel"
    :aria-orientation="orientation"
    :aria-valuenow="Math.round(size)"
    :aria-valuemin="min"
    :aria-valuemax="max"
    @pointerdown="start"
    @dblclick="emit('reset')"
    @keydown.left.prevent="nudge(orientation === 'vertical' ? -16 : 0)"
    @keydown.right.prevent="nudge(orientation === 'vertical' ? 16 : 0)"
    @keydown.up.prevent="nudge(orientation === 'horizontal' ? -16 : 0)"
    @keydown.down.prevent="nudge(orientation === 'horizontal' ? 16 : 0)"
  >
    <span class="handle__line" aria-hidden="true" />
  </div>
</template>

<style scoped>
.handle {
  position: relative;
  flex: 0 0 auto;
  z-index: 5;
  touch-action: none;
}

/*
 * Seven pixels of target over zero pixels of layout: the negative margins
 * cancel the width exactly, so the two panes meet with nothing between them and
 * the handle overhangs them equally. A one-pixel target is a one-pixel target,
 * which is why the box is not simply narrowed to nothing.
 */
.handle--vertical {
  width: 7px;
  margin-inline: -3.5px;
  cursor: col-resize;
}

.handle--horizontal {
  height: 7px;
  margin-block: -3.5px;
  cursor: row-resize;
}

/*
 * Nothing painted. The handle straddles the boundary rather than occupying a
 * column of it, so there is no gap between the panes for anything to show
 * through and nothing for the handle to fill.
 *
 * It used to take one pixel of layout, and that pixel had to be painted: left
 * transparent it was a hole in the page through which the window's own backdrop
 * came up, as a bright vertical line down the full height over any light
 * desktop. Painting it the content pane's surface hid that for as long as the
 * pane's leading edge was straight — and stopped the moment the pane took a
 * rounded corner, because the strip carried on straight up past the curve and
 * stood clear of it as a light stub. Cancelling the width with the margins
 * removes the hole instead of covering it.
 */
.handle__line {
  position: absolute;
  inset: 0;
}

/*
 * A grabber, and it is the whole indicator. A 1px rule that changes colour on
 * hover is a hint that something might be draggable, where a thumb that grows
 * under the pointer says it plainly — and with no rule to change, the thumb is
 * all there is. It appears on hover and takes the accent while held, so the
 * drag reads as engaged rather than merely hovered.
 */
.handle__line::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 3px;
  height: 2.25rem;
  border-radius: 999px;
  background: color-mix(in oklab, var(--color-base-content) 40%, transparent);
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.6);
  transition:
    opacity var(--t-hover) ease,
    transform var(--t-hover) var(--ease-sheet),
    background-color var(--t-hover) ease;
}

.handle--horizontal .handle__line::after {
  width: 2.25rem;
  height: 3px;
}

/*
 * Split from the hover, rather than the three sharing one selector.
 *
 * Focus and a live drag are states that exist on any input; hover is the one
 * that a touch device invents on a tap and then leaves stuck. Gating all three
 * together would have taken the grip away from the keyboard and from the drag
 * itself on the very devices the gate is for.
 */
.handle:focus-visible .handle__line::after,
.handle--dragging .handle__line::after {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}

@media (hover: hover) and (pointer: fine) {
  .handle:hover .handle__line::after {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}

.handle--dragging .handle__line::after {
  background: var(--color-primary);
}

/*
 * The grabber appearing is what a sighted user sees, but a pseudo-element is
 * not an indicator anything can detect — and a keyboard user arriving here
 * needs to know the divider is what they are about to move.
 */
.handle:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -1px;
  border-radius: 999px;
}

@media (prefers-reduced-motion: reduce) {
  .handle__line::after {
    transition: opacity var(--t-press) ease;
    transform: translate(-50%, -50%);
  }

  .handle:hover .handle__line::after,
  .handle--dragging .handle__line::after {
    transform: translate(-50%, -50%);
  }
}
</style>
