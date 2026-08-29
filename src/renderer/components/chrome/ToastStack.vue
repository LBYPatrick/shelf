<script setup lang="ts">
/**
 * Where toasts live.
 *
 * The class is `notice`, not `toast`: daisyUI ships a `.toast` component that
 * is `position: fixed` and stacks its children in a column, so a component of
 * ours wearing that name laid its icon, its message and its close button out
 * one above the other. The gate has a rule about this and did not catch it,
 * because a toast is transient and the gate only looked at what was on screen.
 *
 * Bottom-right, above the status bar: the corner furthest from the sidebar and
 * the tab strip, so a message never lands on top of the thing you were about to
 * click. Newest at the bottom, nearest the eye.
 *
 * A column, not a pile. Several notices at once are several sentences, and a
 * reader who can see all of them has to decide about none of them — where a
 * pile that opens under the pointer makes reading the third one a gesture.
 *
 * Each notice counts down its own expiry rather than the store doing it, because
 * the countdown has to pause while the pointer is on it — a message that leaves
 * while you are reaching for its action button is a message you cannot act on.
 */
import { computed } from 'vue';
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
      :class="{ 'notices--centre': centred }"
      role="region"
      aria-live="polite"
      aria-label="Notifications"
    >
      <!--
        `appear`, because a notice that is already in the list when this mounts
        is still arriving as far as the reader is concerned. It cannot happen in
        the app — the stack is mounted empty and outlives every notice in it —
        but it is the whole of what the stories show, and motion that only runs
        where nobody can look at it is motion nobody checks.
      -->
      <TransitionGroup name="notice" appear>
        <!--
          The wrapper is what arrives and leaves, and that is its whole reason
          for being. The notice itself carries the transform of the hand
          dragging it, and `notice-leave-to` sets a transform of its own — put
          on one element the second would overwrite the first, and a card thrown
          off the trailing edge would jump back to sixteen pixels out to fade.
        -->
        <div v-for="notice in toasts.toasts" :key="notice.id" class="notice-slot">
          <ToastItem :notice="notice" @dismiss="toasts.dismiss(notice.id)" />
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
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
  pointer-events: none;
}

.notices--centre {
  inset-inline: 0;
  inset-block-end: var(--gap-section);
  align-items: center;
}

/* The region must not swallow clicks aimed at the window behind it, so the
   cards take pointer events back one at a time. */
.notice-slot {
  pointer-events: auto;
}

/*
 * In from the edge it is anchored to, and out by the same edge.
 *
 * A transition rather than a keyframe, which is the whole difference: keyframes
 * restart from zero, and a notice is the thing most likely to be interrupted —
 * one arrives while another is leaving, or the reader throws it away before it
 * has finished coming in. A transition retargets from wherever the card
 * actually is.
 *
 * `--t-pop` and `--ease-out`, like every other thing in this app that appears
 * and goes: entering and exiting is what an ease-out is for, and a notice that
 * announced itself on a curve of its own would read as a different app's.
 */
.notice-enter-active,
.notice-leave-active {
  transition:
    opacity var(--t-pop) var(--ease-out),
    transform var(--t-pop) var(--ease-out);
}

.notice-enter-from,
.notice-leave-to {
  opacity: 0;
  transform: translateX(1rem);
}

/* The centred stack has no edge to come from, so it comes up off the floor. */
.notices--centre .notice-enter-from,
.notices--centre .notice-leave-to {
  transform: translateY(0.75rem);
}

/* The ones below a dismissed notice close the gap rather than jumping. */
.notice-move {
  transition: transform var(--t-pop) var(--ease-out);
}

/*
 * Reduced motion is answered in `base.css`, not here.
 *
 * Its global rule takes `transform` out of `transition-property` and every
 * duration down to 150ms, which leaves exactly the fade — the movement gone,
 * the change in state still shown. A block of our own would only restate it,
 * and would be the thing that fell out of step the day that one changed.
 */
</style>
