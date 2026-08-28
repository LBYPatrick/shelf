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

/** What a label needs vertically, for deciding whether it fits under a control. */
const ROOM = 32;

/**
 * Beside the trigger where it fits, and under it where it does not.
 *
 * The rail is at the window's leading edge, so a label to its trailing side is
 * the natural place — it reads outward, in the direction the eye is already
 * travelling, and it never covers the icon it is naming.
 *
 * **A control near the trailing edge used to flip and open backwards over the
 * window.** The new-tab button is the case: it sits at the end of the tab
 * strip, so its label opened leftwards and laid itself across the last two
 * tabs — a label naming one control while hiding two others. Under it is the
 * answer, because a tooltip below a control covers the thing the control acts
 * on rather than its neighbours, and because that is where a tooltip on a
 * toolbar button goes everywhere else.
 *
 * Above, in the one case where below would leave the window. Nothing in this
 * app is close enough to the bottom edge for that today; it is here because
 * "off the bottom of the screen" is a worse failure than either placement.
 */
const placement = computed(() => {
  const { top, bottom, left, right } = tip.anchor;
  void left;

  if (right + GAP + MAX_WIDTH + MARGIN <= globalThis.innerWidth) {
    return {
      beside: true,
      top: `${(top + bottom) / 2}px`,
      left: `${right + GAP}px`,
      origin: 'left center',
    };
  }

  const below = bottom + GAP + ROOM + MARGIN <= globalThis.innerHeight;

  return {
    beside: false,
    top: below ? `${bottom + GAP}px` : `${top - GAP - ROOM}px`,
    // Aligned to the trigger's trailing edge, which is the edge it was pushed
    // against — anything else would put the label back over the window.
    right: `${globalThis.innerWidth - right}px`,
    origin: below ? 'top right' : 'bottom right',
  };
});
</script>

<template>
  <Teleport to="body">
    <Transition name="tip">
      <div
        v-if="tip.visible"
        class="hovertip"
        :class="{ 'hovertip--instant': tip.instant, 'hovertip--beside': placement.beside }"
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
/*
 * Centred on the trigger only when it is beside it. Under or over it, the
 * `top` already names the edge the label starts at, and half a label's height
 * of correction would put it back across the control.
 */
.hovertip {
  position: fixed;
  z-index: 300;
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

/* Centred on the trigger only when it is beside it. Under or over it, `top`
   already names the edge the label starts at, and half a label's height of
   correction would put it back across the control. */
.hovertip--beside {
  translate: 0 -50%;
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
