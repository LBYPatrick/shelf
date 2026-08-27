<script setup lang="ts">
/**
 * What a result looks like before it arrives.
 *
 * The word "Running…" beside a two-pixel bar was the whole of it, centred in an
 * empty pane — which says that something is happening and nothing about *what*,
 * and leaves the eye with nowhere to rest for however long the query takes. A
 * skeleton says the shape of the answer: rows are coming, in columns, into this
 * space. When they land they replace something the same size, so the pane does
 * not lurch.
 *
 * The sheen is one gradient travelling across the whole block rather than a
 * pulse on each bar. A field of independently blinking rectangles reads as a
 * fault; one light passing over reads as a surface being revealed — and it is a
 * single compositor-friendly `translate`, not sixty opacity animations.
 */
withDefaults(defineProps<{ rows?: number; columns?: number }>(), {
  rows: 10,
  columns: 5,
});

/** Varied but fixed, so the placeholder does not shimmer *and* reflow. */
const WIDTHS = [92, 64, 78, 55, 86, 70, 60, 88];
</script>

<template>
  <div class="skeleton" role="status" :aria-label="$t('query.running')">
    <div class="skeleton__head">
      <span
        v-for="column in columns"
        :key="column"
        class="skeleton__cell skeleton__cell--head"
        :style="{ width: `${WIDTHS[(column * 3) % WIDTHS.length]}%` }"
      />
    </div>

    <div v-for="row in rows" :key="row" class="skeleton__row">
      <span
        v-for="column in columns"
        :key="column"
        class="skeleton__cell"
        :style="{ width: `${WIDTHS[(row + column * 2) % WIDTHS.length]}%` }"
      />
    </div>

    <span class="skeleton__sheen" aria-hidden="true" />
  </div>
</template>

<style scoped>
.skeleton {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  /* The rows below the fold are not information, so they fade out rather than
     being cut off against the bottom of the pane. */
  mask-image: linear-gradient(to bottom, #000 60%, transparent 100%);
}

.skeleton__head,
.skeleton__row {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: var(--gap-loose);
  align-items: center;
  height: var(--row-h);
  padding-inline: var(--gap-loose);
  border-bottom: 1px solid var(--separator);
}

.skeleton__head {
  height: var(--row-h);
  background: var(--fill-4);
}

.skeleton__cell {
  height: 0.5rem;
  border-radius: 999px;
  background: color-mix(in oklab, var(--color-base-content) 11%, transparent);
}

/* The header's bars are the column names, which are always there and always
   darker than the values under them. */
.skeleton__cell--head {
  height: 0.4375rem;
  background: color-mix(in oklab, var(--color-base-content) 20%, transparent);
}

/*
 * One light, travelling. `translate` only, so it composites without touching
 * layout or paint — a full-width gradient animating its `background-position`
 * repaints the whole pane every frame.
 */
.skeleton__sheen {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  width: 45%;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in oklab, var(--color-base-content) 6%, transparent),
    transparent
  );
  animation: skeleton-sheen 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  will-change: transform;
}

@keyframes skeleton-sheen {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(322%);
  }
}

/*
 * The sheen is the one part that is purely motion, so it is the part that goes.
 * The bars stay: they are the message, and a still skeleton still says "rows
 * are coming" — which is more than the word it replaced ever did.
 */
@media (prefers-reduced-motion: reduce) {
  .skeleton__sheen {
    animation: none;
    opacity: 0;
  }
}
</style>
