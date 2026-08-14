<script setup lang="ts">
/**
 * The divider between two panes.
 *
 * It tracks the pointer one-to-one and resists at its limits instead of
 * stopping dead, so dragging a sidebar to its minimum feels like reaching the
 * end of something physical rather than hitting a bug. The hit area is wider
 * than the visible line, because a 1px target is a 1px target.
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

const emit = defineEmits<{ 'update:size': [number]; 'collapse-toggle': [] }>();

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
    @dblclick="emit('collapse-toggle')"
    @keydown.left.prevent="nudge(orientation === 'vertical' ? -16 : 0)"
    @keydown.right.prevent="nudge(orientation === 'vertical' ? 16 : 0)"
    @keydown.up.prevent="nudge(orientation === 'horizontal' ? -16 : 0)"
    @keydown.down.prevent="nudge(orientation === 'horizontal' ? 16 : 0)"
  >
    <span
      class="handle__line"
      aria-hidden="true"
    />
  </div>
</template>

<style scoped>
.handle {
  position: relative;
  flex: 0 0 auto;
  z-index: 5;
  touch-action: none;
}

.handle--vertical {
  width: 7px;
  margin-inline: -3px;
  cursor: col-resize;
}

.handle--horizontal {
  height: 7px;
  margin-block: -3px;
  cursor: row-resize;
}

/*
 * The handle occupies a one-pixel column of layout between the two panes, and
 * that column has to be painted. Left transparent it was a gap in the page
 * through which the window's own backdrop showed — a bright vertical line down
 * the full height of the window over any light desktop, in either theme, which
 * no amount of adjusting the panels' colours could remove because the line was
 * not being drawn by the page at all.
 *
 * It wears the content pane's surface, so the seam reads as the content
 * starting a pixel earlier rather than as a rule between two panels.
 */
.handle__line {
  position: absolute;
  inset: 0;
  background-color: var(--color-base-100);
  transition: background-color 160ms ease-out;
}

.handle--vertical .handle__line {
  inset-inline: 3px;
}

.handle--horizontal .handle__line {
  inset-block: 3px;
}

/*
 * A grabber rather than a bare line: a 1px rule that changes colour on hover is
 * a hint that something might be draggable, where a thumb that grows under the
 * pointer says it plainly. It appears on hover and takes the accent while held,
 * so the drag reads as engaged rather than merely hovered.
 */
.handle__line::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 3px;
  height: 2.25rem;
  border-radius: 999px;
  background: color-mix(in oklab, var(--color-base-content) 40%, var(--color-base-100));
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.6);
  transition:
    opacity 180ms ease,
    transform 180ms cubic-bezier(0.32, 0.72, 0, 1),
    background-color 180ms ease;
}

.handle--horizontal .handle__line::after {
  width: 2.25rem;
  height: 3px;
}

.handle:hover .handle__line,
.handle--dragging .handle__line,
.handle:focus-visible .handle__line {
  background: var(--fill-2);
}

.handle:hover .handle__line::after,
.handle:focus-visible .handle__line::after,
.handle--dragging .handle__line::after {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
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
    transition: opacity 120ms ease;
    transform: translate(-50%, -50%);
  }

  .handle:hover .handle__line::after,
  .handle--dragging .handle__line::after {
    transform: translate(-50%, -50%);
  }
}

.handle--dragging .handle__line {
  transition: none;
}
</style>
