<script setup lang="ts">
/**
 * Where toasts live, and how several of them get out of each other's way.
 *
 * The class is `notice`, not `toast`: daisyUI ships a `.toast` component that
 * is `position: fixed` and stacks its children in a column, so a component of
 * ours wearing that name laid its icon, its message and its close button out
 * one above the other. The gate has a rule about this and did not catch it,
 * because a toast is transient and the gate only looked at what was on screen.
 *
 * Bottom-right, above the status bar: the corner furthest from the sidebar and
 * the tab strip, so a message never lands on top of the thing you were about to
 * click. Newest at the front, nearest the eye.
 *
 * **They stack, and they open when you look at them.** A plain column was fine
 * for one notice and wrong for four: an export finishing behind a failed query
 * behind two settings confirmations is a wall of cards up the side of the
 * window, each with a close button, each demanding to be read. Collapsed they
 * are a pile — the newest fully drawn, the two behind it peeking out by a few
 * pixels and shrinking — and the pile opens into the full column under the
 * pointer, which is when somebody has decided to read them.
 *
 * The geometry is measured rather than assumed, because a notice is as tall as
 * its message: an offset of "one card height" would leave gaps under the short
 * ones and overlaps under the long ones. Each slot is anchored to the bottom
 * edge and translated up by the heights of the ones in front of it.
 *
 * Each notice counts down its own expiry rather than the store doing it, because
 * the countdown has to pause while the pointer is on it — and while the pile is
 * open, for every card in it, or reading the third one costs you the first two.
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import { useConnections } from '../../stores/connections';
import { useToasts } from '../../stores/toasts';
import ToastItem from './ToastItem.vue';

const toasts = useToasts();
const connections = useConnections();

/*
 * Centred on the start screen, in the corner in the workspace.
 *
 * The corner is chosen for a window with a sidebar, a tab strip and a status
 * bar in it — it is the one place a message cannot land on something you were
 * about to click. The start screen has none of that: it is a small centred
 * panel in a small centred window, and a notice pinned to its bottom-right
 * reads as having come loose from it.
 */
const centred = computed(() => connections.active === null);

/* ------------------------------------------------------------------ pile */

/** How far each card behind the front one peeks out, in pixels. */
const PEEK = 9;

/** How much smaller each card behind the front one is drawn. */
const SHRINK = 0.045;

/** Cards drawn in a collapsed pile. Past this they are behind the pile. */
const VISIBLE = 3;

/** The column's gap when the pile is open. Matches `--gap-tight` closely enough. */
const GAP = 8;

const expanded = ref(false);

/**
 * Each slot's height, measured.
 *
 * One observer for the lot rather than one per card: the cards come and go
 * constantly and an observer per card is a subscription per notice, created and
 * torn down on a timer.
 */
const heights = ref(new Map<string, number>());

const sizes = new ResizeObserver((entries) => {
  const next = new Map(heights.value);
  for (const entry of entries) {
    const id = (entry.target as HTMLElement).dataset['noticeId'];
    if (id) next.set(id, entry.borderBoxSize[0]?.blockSize ?? entry.target.clientHeight);
  }
  heights.value = next;
});

onBeforeUnmount(() => sizes.disconnect());

/**
 * Watching a slot, and forgetting one that has gone.
 *
 * Vue calls this with the element on mount and with `null` on unmount, which is
 * the only signal that a leaving card has actually left — a height kept for a
 * notice that no longer exists would go on making room for it.
 */
function bind(id: string, element: unknown): void {
  if (element instanceof HTMLElement) {
    element.dataset['noticeId'] = id;
    sizes.observe(element);
    return;
  }

  const next = new Map(heights.value);
  next.delete(id);
  heights.value = next;
}

const list = computed(() => toasts.toasts);

/** A card's own height, or a reasonable one until it has been measured. */
function heightOf(id: string): number {
  return heights.value.get(id) ?? 56;
}

/**
 * How far up from the bottom edge this card sits.
 *
 * Open, that is everything in front of it plus the gaps. Collapsed, it is a few
 * pixels per card of depth — enough to say "there are more" and not enough to
 * be a second thing to read.
 */
function offsetOf(index: number): number {
  const depth = list.value.length - 1 - index;
  if (!expanded.value) return PEEK * Math.min(depth, VISIBLE - 1);

  let offset = 0;
  for (let after = index + 1; after < list.value.length; after += 1) {
    offset += heightOf(list.value[after]!.id) + GAP;
  }
  return offset;
}

function styleOf(index: number): Record<string, string> {
  const depth = list.value.length - 1 - index;
  const scale = expanded.value ? 1 : Math.max(0.8, 1 - SHRINK * Math.min(depth, VISIBLE - 1));

  return {
    '--y': `${-offsetOf(index)}px`,
    '--s': String(scale),
    // Behind the pile: still there, still counting down, not drawn. Cheaper
    // and steadier than unmounting it, which would restart its expiry the
    // moment the pile opened.
    '--o': !expanded.value && depth >= VISIBLE ? '0' : '1',
    zIndex: String(index + 1),
  };
}

/** The region's own height, so it is exactly the hover target the pile is. */
const height = computed(() => {
  if (list.value.length === 0) return 0;

  if (!expanded.value) {
    const front = list.value[list.value.length - 1]!;
    return heightOf(front.id) + PEEK * Math.min(list.value.length - 1, VISIBLE - 1);
  }

  return list.value.reduce(
    (total, notice, index) => total + heightOf(notice.id) + (index === 0 ? 0 : GAP),
    0
  );
});
</script>

<template>
  <Teleport to="body">
    <!--
      `aria-live` on the region rather than on each notice: the region exists
      from the start, so a notice added to it is announced. A live region that
      appears at the same moment as its content is a region a screen reader has
      not started watching yet.
    -->
    <div
      class="notices"
      :class="{ 'notices--centre': centred, 'notices--open': expanded }"
      :style="{ blockSize: `${height}px` }"
      role="region"
      aria-live="polite"
      aria-label="Notifications"
      @pointerenter="expanded = true"
      @pointerleave="expanded = false"
      @focusin="expanded = true"
      @focusout="expanded = false"
    >
      <!--
        The durations are declared rather than sniffed.
        ─────────────────────────────────────────────
        Vue works out how long to keep a leaving element by reading the
        transition on the element it is managing — and the animation here is on
        a child, because the parent's transform is the pile's own geometry. So
        the numbers are given: they are the two keyframe durations below, and a
        card removed before its animation finished would vanish mid-flight.
      -->
      <TransitionGroup name="notice" :duration="{ enter: 620, leave: 520 }">
        <div
          v-for="(notice, index) in list"
          :key="notice.id"
          :ref="(element) => bind(notice.id, element)"
          class="slot"
          :style="styleOf(index)"
        >
          <!--
            Three layers, one transform each, and that is the whole reason for
            the extra element. The slot owns *where in the pile* this is, the
            wrapper owns *arriving and leaving*, and the notice itself owns
            *being dragged*. Put on one node they would overwrite each other:
            a bounce keyframe replaces the pile's offset, and a card would drop
            to the bottom of the stack the instant it started to animate in.
          -->
          <div class="slot__in">
            <ToastItem :notice="notice" :held="expanded" @dismiss="toasts.dismiss(notice.id)" />
          </div>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.notices {
  position: fixed;
  inset-block-end: calc(var(--statusbar-h) + var(--gap-loose));
  inset-inline-end: var(--gap-loose);
  z-index: 300;
  inline-size: min(24rem, calc(100vw - 2rem));
  /* The stack must not swallow clicks aimed at the window behind it; the
     notices themselves take pointer events back. */
  pointer-events: none;
  transition: block-size var(--t-pop) var(--ease-out);
}

.notices--centre {
  inset-inline: 0;
  inset-block-end: var(--gap-section);
  margin-inline: auto;
}

/*
 * Anchored to the bottom and lifted, rather than laid out in a column.
 *
 * A column cannot overlap itself, and overlapping is the whole of what a pile
 * is. The origin is the bottom edge so a card shrinking behind the front one
 * pulls up and away rather than sliding down out of the corner.
 */
.slot {
  position: absolute;
  inset-inline: 0;
  inset-block-end: 0;
  pointer-events: auto;
  opacity: var(--o, 1);
  transform: translateY(var(--y, 0)) scale(var(--s, 1));
  transform-origin: bottom center;
  transition:
    transform var(--t-pop) var(--ease-out),
    opacity var(--t-pop) var(--ease-out);
}

/* A card behind the front one is scenery until the pile opens: its close
   button is under another card, and a click that lands on it is a mistake. */
.notices:not(.notices--open) .slot:not(:last-child) {
  pointer-events: none;
}

/*
 * Bounce, which is react-toastify's own default transition.
 *
 * Their `bounceInRight` and `bounceOutRight`, keyframe for keyframe: in from
 * well off the trailing edge, overshooting past the resting point and settling
 * back through two smaller corrections; out with a small wind-up the other way
 * before it goes. Copied rather than approximated because the overshoot *is*
 * the character — an ease-out slide with the same duration reads as a panel
 * appearing, and this reads as something being thrown onto the pile.
 *
 * It runs on the wrapper, never on the slot, so the pile's own offset and this
 * animation are two transforms on two elements instead of one overwriting the
 * other.
 */
.slot__in {
  animation: notice-in 620ms both;
}

.notice-leave-active .slot__in {
  animation: notice-out 520ms both;
}

.notices--centre .slot__in {
  animation-name: notice-in-up;
}

.notices--centre .notice-leave-active .slot__in {
  animation-name: notice-out-down;
}

@keyframes notice-in {
  from,
  60%,
  75%,
  90%,
  to {
    animation-timing-function: cubic-bezier(0.215, 0.61, 0.355, 1);
  }
  from {
    opacity: 0;
    transform: translate3d(3000px, 0, 0);
  }
  60% {
    opacity: 1;
    transform: translate3d(-25px, 0, 0);
  }
  75% {
    transform: translate3d(10px, 0, 0);
  }
  90% {
    transform: translate3d(-5px, 0, 0);
  }
  to {
    transform: none;
  }
}

@keyframes notice-out {
  20% {
    opacity: 1;
    transform: translate3d(-20px, 0, 0);
  }
  to {
    opacity: 0;
    transform: translate3d(2000px, 0, 0);
  }
}

/* The centred stack has no edge to come from, so it comes up off the floor. */
@keyframes notice-in-up {
  from,
  60%,
  75%,
  90%,
  to {
    animation-timing-function: cubic-bezier(0.215, 0.61, 0.355, 1);
  }
  from {
    opacity: 0;
    transform: translate3d(0, 3000px, 0);
  }
  60% {
    opacity: 1;
    transform: translate3d(0, -20px, 0);
  }
  75% {
    transform: translate3d(0, 10px, 0);
  }
  90% {
    transform: translate3d(0, -5px, 0);
  }
  to {
    transform: none;
  }
}

@keyframes notice-out-down {
  20% {
    opacity: 1;
    transform: translate3d(0, -20px, 0);
  }
  to {
    opacity: 0;
    transform: translate3d(0, 2000px, 0);
  }
}

/*
 * What react-toastify calls `collapseToast` falls out of the arrangement.
 *
 * There, a dismissed toast's box has to be animated shut or the ones below it
 * jump up the instant it unmounts. Here every card is absolutely positioned
 * against the container's bottom edge, so a removed card takes its height out
 * of the offsets the moment it leaves the list and the cards above it slide
 * down on the slot's own transform transition — the same one that opens the
 * pile. Nothing jumps, and there is no second animation to keep in step.
 */

@media (prefers-reduced-motion: reduce) {
  .notices {
    transition: none;
  }

  /* No throw and no overshoot: it fades, in place, and that is the whole
     animation. The pile still rearranges, because that is layout rather than
     flourish, but it rearranges at once. */
  .slot__in,
  .notices--centre .slot__in {
    animation: notice-fade-in 120ms both;
  }

  .notice-leave-active .slot__in,
  .notices--centre .notice-leave-active .slot__in {
    animation: notice-fade-out 120ms both;
  }
}

@keyframes notice-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes notice-fade-out {
  to {
    opacity: 0;
  }
}
</style>
