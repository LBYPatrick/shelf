<script setup lang="ts">
/**
 * The zoom, said out loud.
 *
 * A canvas that can be at five per cent has to say so, or a diagram scrolled
 * off the edge and a diagram drawn too small to see are the same empty pane.
 * Out, the number, in, and the whole thing — in that order, because that is the
 * order the hand reaches for them when something has gone missing.
 *
 * It is opaque rather than a pane of its own glass: it sits over a drawing, and
 * the one place a translucent surface cannot go is on top of the thing it is
 * meant to stay legible against.
 */
import AppIcon from '../ui/AppIcon.vue';

defineProps<{ scale: number }>();
const emit = defineEmits<{ zoom: [number]; fit: [] }>();

/** One notch. A ratio, so every press moves the same visual distance. */
const STEP = 1.4;
</script>

<template>
  <div class="zoomer">
    <button
      v-tip="$t('erd.zoomOut')"
      type="button"
      class="zoomer__step focus-fill"
      :aria-label="$t('erd.zoomOut')"
      @click="emit('zoom', 1 / STEP)"
    >
      <AppIcon name="minus" :size="13" />
    </button>

    <span class="zoomer__percent">{{ Math.round(scale * 100) }}%</span>

    <button
      v-tip="$t('erd.zoomIn')"
      type="button"
      class="zoomer__step focus-fill"
      :aria-label="$t('erd.zoomIn')"
      @click="emit('zoom', STEP)"
    >
      <AppIcon name="plus" :size="13" />
    </button>

    <button type="button" class="zoomer__fit focus-fill" @click="emit('fit')">
      {{ $t('erd.fit') }}
    </button>
  </div>
</template>

<style scoped>
/*
 * Built from the app's control language rather than from its own numbers.
 *
 * It had a radius of its own, a height of its own and a shadow written by hand,
 * so a widget floating over a diagram announced itself as belonging to a
 * different app than the toolbar six inches above it. Everything here is the
 * shared token: the buttons are `--field-h` tall with `--control-radius`, the
 * elevation is the one every floating surface uses, and the container's radius
 * is the buttons' radius plus the padding around them — concentric, so the
 * curve of the outer edge stays parallel to the curve of the inner one instead
 * of tightening at the corners.
 */
.zoomer {
  position: absolute;
  right: var(--gap);
  bottom: var(--gap);
  display: flex;
  align-items: center;
  gap: var(--gap-hair);
  padding: var(--gap-hair);
  border-radius: calc(var(--control-radius) + var(--gap-hair));
  border: 1px solid var(--separator);
  background: var(--color-base-100);
  box-shadow: var(--elev-popover);
}

.zoomer__step,
.zoomer__fit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--field-h);
  height: var(--field-h);
  border-radius: var(--control-radius);
  color: color-mix(in oklab, var(--color-base-content) 72%, transparent);
  font-size: 0.75rem;
  font-weight: 500;
  transition:
    background-color var(--t-hover) var(--ease-out),
    color var(--t-hover) var(--ease-out),
    transform var(--t-press) var(--ease-out);
}

.zoomer__fit {
  padding-inline: var(--gap);
}

/* The same press the rest of the app gives, on the press rather than the
   release — a floating control is still a control. */
.zoomer__step:active,
.zoomer__fit:active {
  transform: scale(0.97);
}

/*
 * The number is the one thing here that is read rather than pressed, so it is
 * quieter than the buttons around it and set in tabular figures — a percentage
 * that shifts sideways as it counts is a percentage nobody can watch.
 */
.zoomer__percent {
  min-width: 3rem;
  text-align: center;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
}

@media (hover: hover) and (pointer: fine) {
  .zoomer__step:hover,
  .zoomer__fit:hover {
    background-color: var(--fill-3);
    color: var(--color-base-content);
  }
}

@media (prefers-reduced-motion: reduce) {
  .zoomer__step:active,
  .zoomer__fit:active {
    transform: none;
  }
}
</style>
