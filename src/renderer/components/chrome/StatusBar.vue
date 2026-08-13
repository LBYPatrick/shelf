<script setup lang="ts">
/**
 * The status bar.
 *
 * The connection's identity is fixed on the left, tinted by its label colour so
 * the difference between staging and production is visible without reading. The
 * rest is contributed by whichever tab is active, which is why it is a teleport
 * target rather than a component that knows about tabs.
 */
import { useConnections } from '../../stores/connections';

const connections = useConnections();
</script>

<template>
  <footer class="statusbar mat-regular">
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
  border-top: 1px solid color-mix(in oklab, var(--color-base-content) 8%, transparent);
  font-size: 0.6875rem;
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
