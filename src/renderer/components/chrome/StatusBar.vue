<script setup lang="ts">
/**
 * The status bar.
 *
 * The connection's identity is fixed on the left, tinted by its label colour so
 * the difference between staging and production is visible without reading. The
 * rest is contributed by whichever tab is active, which is why it is a teleport
 * target rather than a component that knows about tabs.
 */
import { useActivity } from '../../stores/activity';
import { useConnections } from '../../stores/connections';

const connections = useConnections();
const activity = useActivity();
</script>

<template>
  <footer
    class="statusbar mat-regular"
    :class="{
      'statusbar--busy': activity.busy,
      'statusbar--ok': !activity.busy && activity.outcome === 'ok',
      'statusbar--error': !activity.busy && activity.outcome === 'error',
    }"
  >
    <!--
      The wash is a layer rather than the bar's own background: the bar is a
      material, and animating a material's `background-color` would fight the
      opacity dial for the same property. A layer on top composites over
      whatever the glass resolved to, at any setting.
    -->
    <span
      class="statusbar__wash"
      aria-hidden="true"
    />

    <!--
      Announced once, politely. The colour is the fast channel and the text is
      the accessible one; a screen reader should hear "query failed" rather than
      nothing at all because the signal was a shade of red.
    -->
    <span
      class="sr-only"
      role="status"
    >{{
      activity.busy
        ? $t('activity.working')
        : activity.outcome === 'ok'
          ? $t('activity.done')
          : activity.outcome === 'error'
            ? $t('activity.failed')
            : ''
    }}</span>

    <!--
      The connection's identity lives in the title bar, where the eye already
      goes. Repeating it here would be two places to keep in agreement and one
      more thing competing with what the active tab has to say.
    -->
    <span class="statusbar__version">
      <span
        class="statusbar__dot"
        :style="
          connections.active?.labelColor
            ? { '--label': connections.active.labelColor }
            : undefined
        "
        aria-hidden="true"
      />
      {{ connections.active?.version }}
    </span>

    <!-- Filled by the active tab. -->
    <div
      id="statusbar-slot"
      class="statusbar__slot"
    />
  </footer>
</template>

<style scoped>
.statusbar {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--gap-loose);
  height: var(--statusbar-h);
  /*
   * Nothing is ever drawn outside the bar. Whatever the active tab contributes,
   * a value cut in half by the window edge reads as a rendering fault, and the
   * bar is the last place that should look broken.
   */
  overflow: hidden;
  /* Clears the window's rounded bottom corners, which were clipping the
     row count on the right and the connection dot on the left. */
  padding-inline: var(--gap-section);
  border-top: 1px solid var(--separator);
  font-size: 0.6875rem;
}

/*
 * Breathing while it works, a wash when it stops.
 *
 * Slow on purpose — a fast pulse in the corner of the eye is an alarm, and this
 * is only saying "still going". The finished states are brief and fade rather
 * than cut, because the moment worth noticing is the *change*, not the colour
 * sitting there afterwards.
 */
.statusbar__wash {
  position: absolute;
  inset: 0;
  opacity: 0;
  pointer-events: none;
  background: currentColor;
  transition: opacity var(--t-sheet) var(--ease-out);
}

.statusbar--busy .statusbar__wash {
  background: var(--color-primary);
  animation: statusbar-breathe 1.8s ease-in-out infinite;
}

.statusbar--ok .statusbar__wash {
  background: var(--color-success);
  animation: statusbar-flash 1.4s var(--ease-out) forwards;
}

.statusbar--error .statusbar__wash {
  background: var(--color-error);
  animation: statusbar-flash 1.4s var(--ease-out) forwards;
}

@keyframes statusbar-breathe {
  0%,
  100% {
    opacity: 0.06;
  }
  50% {
    opacity: 0.24;
  }
}

@keyframes statusbar-flash {
  0% {
    opacity: 0.34;
  }
  100% {
    opacity: 0;
  }
}

/*
 * Reduced motion keeps the information and drops the movement: a steady tint
 * while working, and a finished state that fades once instead of pulsing.
 */
@media (prefers-reduced-motion: reduce) {
  .statusbar--busy .statusbar__wash {
    animation: none;
    opacity: 0.16;
  }

  .statusbar--ok .statusbar__wash,
  .statusbar--error .statusbar__wash {
    animation: none;
    opacity: 0.24;
  }
}

/* The bar's own contents sit above the wash. */
.statusbar__version,
.statusbar__slot {
  position: relative;
}

.statusbar__dot {
  display: inline-block;
  width: 0.4375rem;
  height: 0.4375rem;
  margin-inline-end: 4px;
  border-radius: 999px;
  background: var(--label, var(--color-success));
}

.statusbar__version {
  /* The version is the first thing to give up room when the active tab has a
     lot to say; the tab's own status is more useful moment to moment. */
  flex: 0 1 auto;
  min-width: 0;
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * The active tab's contribution is the part that must survive: it carries the
 * row count, the pager and the transaction state. It keeps its size and the
 * version beside it gives up room instead — at a narrow window the row count
 * used to run past the right edge and be cut mid-character by the window
 * itself, which reads as a rendering fault rather than as "there is more here".
 */
/*
 * The slot takes the remaining space and right-aligns what the tab puts in it,
 * rather than being sized by that content and pushed right by an auto margin.
 *
 * The difference is not cosmetic: the content arrives by `<Teleport>` after the
 * bar has already laid itself out, and the slot's intrinsic width was resolving
 * against the empty box it had at that moment — 8px. Everything the tab
 * contributed was then laid out from the right edge *outwards*, which is why
 * the row count was drawn past the window and cut in half. Given a share of the
 * row instead, there is no intrinsic size to get wrong.
 */
.statusbar__slot {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  white-space: nowrap;
}

/*
 * The tab's group is given the slot's full width rather than being sized by its
 * own contents.
 *
 * `<Teleport>` inserts it after the bar has already laid itself out, and the
 * group's intrinsic width was resolving against the empty box it had at that
 * moment — 8px, whatever it actually contained. Everything inside was then laid
 * out from that 8px box rightwards, which is how the row count ended up drawn
 * past the window edge and cut in half. Filling the slot removes the intrinsic
 * measurement from the problem entirely, and the rule lives here so every tab
 * gets it rather than each having to remember.
 */
.statusbar__slot :deep(> *) {
  width: 100%;
  min-width: 0;
  justify-content: flex-end;
}
/*
 * When the window is narrow the version is what goes. It is the least useful
 * thing here and the only one that is never acted on; the row count, the pager
 * and the transaction state all are.
 */
@media (max-width: 34rem) {
  .statusbar__version {
    display: none;
  }
}
</style>
