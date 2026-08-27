<script setup lang="ts">
/**
 * Work is happening and nobody can say how much is left.
 *
 * A hairline that sweeps rather than fills, because a determinate bar would be
 * a lie: a database has no idea how far through a query it is. Ported from the
 * sibling project, including the reason its sweep stops under reduced motion —
 * an infinite animation that never resolves is the textbook case, and the bar
 * itself is what says "working", not the movement.
 */
defineProps<{ tone?: 'primary' | 'error' }>();
</script>

<template>
  <div class="bar" role="progressbar" aria-busy="true">
    <span class="bar__sweep" :class="`bar__sweep--${tone ?? 'primary'}`" />
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
  animation: sweep 1.1s cubic-bezier(0.65, 0, 0.35, 1) infinite;
}

.bar__sweep--primary {
  background: linear-gradient(90deg, transparent, var(--color-primary), transparent);
}

.bar__sweep--error {
  background: linear-gradient(90deg, transparent, var(--color-error), transparent);
}

@keyframes sweep {
  to {
    transform: translateX(350%);
  }
}

/*
 * Still, but present. The bar says work is happening; the sweep only says it
 * prettily, and it is the part that never stops.
 */
@media (prefers-reduced-motion: reduce) {
  .bar__sweep {
    animation: none;
    inset-inline: 0;
    width: 100%;
    opacity: 0.6;
  }
}
</style>
