<script setup lang="ts">
/**
 * The one tooltip the window has.
 *
 * Mounted once beside the toasts, because there is only ever one showing and a
 * component per trigger is several hundred elements standing by to be a label.
 * The state and the `v-tip` directive that drives it live in `lib/hoverTip.ts`.
 *
 * Opaque, like every other surface that appears in front of the window: this
 * one lands over the glass columns, and glass on glass is the arrangement that
 * collapses legibility.
 */
import { computed } from 'vue';
import { tip } from '../../lib/hoverTip';

/** The gap between the trigger and the label, and the room a flip needs. */
const GAP = 8;
const MARGIN = 8;
/** Wide enough for a rail label, short enough that a long one wraps. */
const MAX_WIDTH = 260;

/**
 * Beside the trigger, on whichever side it fits.
 *
 * The rail is at the window's leading edge, so a label to its trailing side is
 * the natural place — it reads outward, in the direction the eye is already
 * travelling, and it never covers the icon it is naming.
 */
const placement = computed(() => {
  const { top, bottom, left, right } = tip.anchor;
  const flip = right + GAP + MAX_WIDTH + MARGIN > globalThis.innerWidth;

  return {
    top: `${(top + bottom) / 2}px`,
    ...(flip
      ? { right: `${globalThis.innerWidth - left + GAP}px`, origin: 'right center' }
      : { left: `${right + GAP}px`, origin: 'left center' }),
  };
});
</script>

<template>
  <Teleport to="body">
    <Transition name="tip">
      <div
        v-if="tip.visible"
        class="hovertip"
        :class="{ 'hovertip--instant': tip.instant }"
        :style="{
          top: placement.top,
          left: placement.left,
          right: placement.right,
          transformOrigin: placement.origin,
          maxWidth: `${MAX_WIDTH}px`,
        }"
        aria-hidden="true"
      >
        {{ tip.label }}
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/*
 * Hidden from assistive technology entirely. Every trigger already carries an
 * `aria-label`, which is what a screen reader announces; a tooltip repeating it
 * is the same word twice.
 */
.hovertip {
  position: fixed;
  z-index: 300;
  translate: 0 -50%;
  padding: 0.3rem 0.6rem;
  border-radius: 0.5rem;
  background: var(--color-base-100);
  box-shadow: var(--elev-popover);
  color: var(--color-base-content);
  font-size: 0.75rem;
  line-height: 1.35;
  white-space: normal;
  pointer-events: none;
}

/*
 * Out of the trigger, not out of nowhere: the origin is set to the edge the
 * label grows from, so the movement states where it came from. Nothing in the
 * world appears from nothing, so it starts at 0.97 rather than at zero.
 */
.tip-enter-active {
  transition:
    opacity 130ms var(--ease-out),
    scale 130ms var(--ease-out);
}

.tip-leave-active {
  transition: opacity 90ms var(--ease-out);
}

.tip-enter-from,
.tip-leave-to {
  opacity: 0;
}

.tip-enter-from {
  scale: 0.97;
}

/*
 * Moving along a row of icons is one gesture. Once a label is up the next one
 * arrives with no delay, and animating it again would put the wait back in a
 * different form.
 */
.hovertip--instant.tip-enter-active {
  transition: none;
}

@media (prefers-reduced-motion: reduce) {
  .tip-enter-from {
    scale: 1;
  }
}
</style>
