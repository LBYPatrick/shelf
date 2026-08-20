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
      <TransitionGroup name="notice">
        <ToastItem
          v-for="notice in toasts.toasts"
          :key="notice.id"
          :notice="notice"
          @dismiss="toasts.dismiss(notice.id)"
        />
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
  /* The stack must not swallow clicks aimed at the window behind it; the
     notices themselves take pointer events back. */
  pointer-events: none;
}

.notices--centre {
  inset-inline: 0;
  inset-block-end: var(--gap-section);
  align-items: center;
}

.notices > * {
  pointer-events: auto;
}

/* In from the edge it will leave by, which is the edge it is anchored to —
   sideways against the corner, upward when it is centred and has no edge. */
.notices--centre .notice-enter-from,
.notices--centre .notice-leave-to {
  transform: translateY(0.75rem);
}

/* In from the edge it will leave by, which is the edge it is anchored to. */
.notice-enter-active,
.notice-leave-active {
  transition:
    transform var(--t-pop) var(--ease-out),
    opacity var(--t-pop) var(--ease-out);
}

.notice-enter-from,
.notice-leave-to {
  opacity: 0;
  transform: translateX(1rem);
}

/* The ones below a dismissed notice close the gap rather than jumping. */
.notice-move {
  transition: transform var(--t-pop) var(--ease-out);
}

@media (prefers-reduced-motion: reduce) {
  .notice-enter-from,
  .notice-leave-to {
    transform: none;
  }
}
</style>
