<script setup lang="ts">
/**
 * Work is happening, and sometimes how much of it is left.
 *
 * A hairline that sweeps rather than fills, because for almost everything in
 * this app a determinate bar would be a lie: a database has no idea how far
 * through a query it is. Ported from the sibling project, including the reason
 * its sweep stops under reduced motion — an infinite animation that never
 * resolves is the textbook case, and the bar itself is what says "working", not
 * the movement.
 *
 * `value` is the exception, and it is a narrow one: a download *does* know, to
 * the byte, and telling somebody a hundred megabytes is arriving without
 * telling them how much has arrived is withholding the only fact they want. It
 * fills by `scaleX` rather than by width so the frames composite, and it is
 * given no easing beyond a short one — a progress bar that catches up smoothly
 * is a progress bar that is behind.
 */
defineProps<{ tone?: 'primary' | 'error'; value?: number }>();
</script>

<template>
  <div
    class="bar"
    role="progressbar"
    :aria-busy="value === undefined"
    :aria-valuenow="value === undefined ? undefined : Math.round(value * 100)"
    :aria-valuemin="value === undefined ? undefined : 0"
    :aria-valuemax="value === undefined ? undefined : 100"
  >
    <span
      v-if="value === undefined"
      class="bar__sweep"
      :class="`bar__sweep--${tone ?? 'primary'}`"
    />
    <span
      v-else
      class="bar__fill"
      :class="`bar__fill--${tone ?? 'primary'}`"
      :style="{ transform: `scaleX(${Math.min(1, Math.max(0, value))})` }"
    />
  </div>
</template>

<style scoped>
.bar {
  position: relative;
  height: 2px;
  overflow: hidden;
  background: color-mix(in oklab, var(--color-primary) 12%, transparent);
}

.bar__sweep {
  position: absolute;
  inset-block: 0;
  inset-inline-start: -40%;
  width: 40%;
  animation: sweep 1.1s var(--ease-in-out) infinite;
}

.bar__sweep--primary {
  background: linear-gradient(90deg, transparent, var(--color-primary), transparent);
}

.bar__sweep--error {
  background: linear-gradient(90deg, transparent, var(--color-error), transparent);
}

.bar__fill {
  position: absolute;
  inset: 0;
  transform-origin: left center;
  /*
   * The shortest step on the scale, because this one is a ceiling rather than a
   * choice: `download-progress` fires per chunk, at an interval nothing here
   * can know, and a transition longer than that interval renders a position the
   * bar never reaches and quietly disagrees with the byte count printed under
   * it. 140ms is the floor the scale offers; if a real download ever shows the
   * fill trailing its own number, that is a measurement worth having before
   * anybody adds a sixth duration to `base.css` for one element.
   */
  transition: transform var(--t-press) linear;
}

.bar__fill--primary {
  background: var(--color-primary);
}

.bar__fill--error {
  background: var(--color-error);
}

/*
 * Still, but present. The bar says work is happening; the sweep only says it
 * prettily, and it is the part that never stops. A determinate fill is not
 * decoration — it is the number — so it keeps moving and only stops easing.
 */
@media (prefers-reduced-motion: reduce) {
  .bar__sweep {
    animation: none;
    inset-inline: 0;
    width: 100%;
    opacity: 0.6;
  }

  .bar__fill {
    transition: none;
  }
}

@keyframes sweep {
  to {
    transform: translateX(350%);
  }
}
</style>
