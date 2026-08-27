<script setup lang="ts">
/**
 * A switch, in the Cupertino shape.
 *
 * Different from a checkbox in what it claims, not only in how it looks: a
 * checkbox is a thing you tick as part of filling something in, and a switch is
 * a setting that takes effect the moment it moves. Everything about the shape
 * says that — it has two named halves, the knob is *in* one of them, and it
 * carries its state as a position rather than as a mark.
 *
 * The motion is the point of the control. The knob travels rather than jumping,
 * and it stretches very slightly as it goes: a rigid dot sliding reads as a
 * value being set, and a shape that gives a little reads as a physical thing
 * being pushed across. It is one spring-shaped curve on `transform`, so it
 * composites and cannot be interrupted into an inconsistent state.
 */
const model = defineModel<boolean>({ required: true });

withDefaults(defineProps<{ ariaLabel: string; disabled?: boolean }>(), { disabled: false });
</script>

<template>
  <button
    type="button"
    class="switch"
    :class="{ 'switch--on': model }"
    role="switch"
    :aria-checked="model"
    :aria-label="ariaLabel"
    :disabled="disabled"
    @click="model = !model"
  >
    <span class="switch__knob" aria-hidden="true" />
  </button>
</template>

<style scoped>
.switch {
  position: relative;
  flex: 0 0 auto;
  /*
   * The track is 1.75× its height, which is the ratio that leaves the knob
   * clearly inside one half rather than filling the whole track — the thing
   * that makes the two positions readable at a glance.
   */
  width: 2.125rem;
  height: 1.25rem;
  border-radius: 999px;
  background: color-mix(in oklab, var(--color-base-content) 22%, transparent);
  transition: background-color 220ms cubic-bezier(0.32, 0.72, 0, 1);
}

.switch--on {
  background: var(--color-primary);
}

.switch:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/*
 * Always white, on either side. The knob is a physical object lit from the
 * front, not a swatch of the theme — tinting it would make the off position
 * look disabled on the dark theme and invisible on the light one.
 */
.switch__knob {
  position: absolute;
  top: 0.125rem;
  left: 0.125rem;
  width: 1rem;
  height: 1rem;
  border-radius: 999px;
  background: #fff;
  box-shadow:
    0 1px 2px rgb(0 0 0 / 25%),
    0 0 0 0.5px rgb(0 0 0 / 6%);
  transition: transform 220ms cubic-bezier(0.32, 0.72, 0, 1);
}

.switch--on .switch__knob {
  transform: translateX(0.875rem);
}

/*
 * The stretch: held down, the knob elongates toward where it is going. It is
 * the whole of what makes the control feel like it has weight, and it costs one
 * more transform on an element that is already composited.
 */
.switch:active:not(:disabled) .switch__knob {
  width: 1.25rem;
}

.switch--on:active:not(:disabled) .switch__knob {
  transform: translateX(0.625rem);
}

.switch:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .switch,
  .switch__knob {
    transition: none;
  }

  .switch:active:not(:disabled) .switch__knob {
    width: 1rem;
  }
}
</style>
