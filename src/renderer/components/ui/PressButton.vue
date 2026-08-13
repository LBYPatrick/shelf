<script setup lang="ts">
/**
 * A button whose feedback lands on pointer-down.
 *
 * Waiting for `click` to show a response puts the acknowledgement after the
 * user has already let go, which is the single most common reason an interface
 * feels sluggish. The scale is small and the timing short, so it reads as the
 * surface yielding rather than as an animation.
 */
withDefaults(
  defineProps<{
    variant?: 'primary' | 'ghost' | 'glass' | 'danger';
    size?: 'sm' | 'md';
    disabled?: boolean;
    active?: boolean;
    /**
     * Buttons default to `submit`, which inside a form makes every unrelated
     * action submit it. Nothing here submits unless it says so.
     */
    type?: 'button' | 'submit';
  }>(),
  { variant: 'ghost', size: 'md', disabled: false, active: false, type: 'button' }
);
</script>

<template>
  <button
    :type="type"
    class="press"
    :class="[`press--${variant}`, `press--${size}`, { 'press--active': active }]"
    :disabled="disabled"
    :aria-pressed="active || undefined"
  >
    <slot />
  </button>
</template>

<style scoped>
/*
 * One shape, one texture. A neutral button is a flat tonal fill with no edge
 * and no shadow — the hairline it used to carry was doing the separating the
 * fill is supposed to do, which left every button looking outlined and none of
 * them looking pressable. Shadow is reserved for things that genuinely float.
 */
.press {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--gap-tight);
  border-radius: var(--control-radius);
  white-space: nowrap;
  font-weight: 500;
  color: var(--color-base-content);
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    color 0.18s ease,
    transform 0.12s cubic-bezier(0.32, 0.72, 0, 1);
}

/*
 * `sm` and `md` differ in how much room they take horizontally and how loud the
 * label is, never in whether they can be hit: both clear the target floor.
 */
.press--sm {
  min-height: var(--hit-min);
  min-width: var(--hit-min);
  padding-inline: var(--gap);
  font-size: 0.6875rem;
}

.press--md {
  min-height: var(--field-h);
  min-width: var(--hit-min);
  padding-inline: var(--gap-loose);
  font-size: 0.8125rem;
}

.press:active:not(:disabled) {
  transform: scale(0.97);
}

/*
 * Unavailable, not faded. Dropping a filled accent button to 40% opacity gives
 * pale colour carrying pale white text — it reads as a rendering fault rather
 * than as "you cannot do this yet". An unavailable action loses its fill and
 * keeps a legible label instead.
 */
.press:disabled {
  cursor: not-allowed;
  color: color-mix(in oklab, var(--color-base-content) 38%, transparent);
}

.press--primary:disabled,
.press--danger:disabled {
  background: var(--fill-3);
  box-shadow: none;
}

.press--ghost:disabled,
.press--glass:disabled {
  background-color: transparent;
}

.press:focus-visible {
  outline: none;
  background-image: linear-gradient(var(--focus-fill), var(--focus-fill));
}

/* The resting surface for a neutral button: tertiary fill, no edge, no lift. */
.press--glass {
  background-color: var(--fill-3);
  border: 1px solid transparent;
  box-shadow: none;
}

/*
 * Ghost is quiet because of its surface, never because its label is hard to
 * read — dimming the text as well is what puts a ghost button under 3:1 on a
 * light panel.
 */
.press--ghost {
  background-color: transparent;
  border: 1px solid transparent;
  color: var(--color-base-content);
}

.press--primary {
  background: var(--color-primary);
  color: var(--color-primary-content);
  border: 1px solid transparent;
}

@media (hover: hover) and (pointer: fine) {
  .press--glass:hover:not(:disabled) {
    background-color: var(--fill-2);
  }

  /* One step below a resting grey button: a hovered ghost should read as
     "there is a control here", not as a filled button that has arrived. */
  .press--ghost:hover:not(:disabled) {
    background-color: var(--fill-4);
  }

  .press--primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
}

.press--ghost.press--active {
  background: color-mix(in oklab, var(--color-primary) 16%, transparent);
  color: var(--color-primary-text, var(--color-primary));
}

.press--primary:active:not(:disabled) {
  background: var(--accent-press);
}

/*
 * Destructive actions are named by their colour, not filled with it: a solid
 * red button is louder than the action usually deserves and, sitting in a
 * toolbar of grey buttons, pulls the eye away from the one you actually came
 * for. It fills only on hover, when you are already committed to reaching it.
 */
.press--danger {
  background-color: var(--fill-3);
  border: 1px solid transparent;
  color: var(--color-error);
}

@media (hover: hover) and (pointer: fine) {
  .press--danger:hover:not(:disabled) {
    background: var(--color-error);
    color: var(--color-error-content);
  }
}
</style>
