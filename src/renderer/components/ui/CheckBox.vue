<script setup lang="ts">
/**
 * A checkbox.
 *
 * The native control ignores the accent entirely — it paints itself the system
 * blue no matter what the interface is doing, which is the single loudest
 * "unstyled" tell in a form. This keeps the real input for keyboard and screen
 * readers and draws the box itself.
 *
 * The tick is a stroked path revealed by its own dash offset, so it draws on
 * rather than appearing, which is what makes the state change feel like an act
 * rather than a repaint.
 */
defineProps<{ label?: string; hint?: string; disabled?: boolean }>();
const model = defineModel<boolean>({ required: true });
</script>

<template>
  <label
    class="check"
    :class="{ 'check--disabled': disabled }"
  >
    <input
      v-model="model"
      class="check__input"
      type="checkbox"
      :disabled="disabled"
    >

    <span
      class="check__box"
      aria-hidden="true"
    >
      <svg
        class="check__tick"
        viewBox="0 0 16 16"
        fill="none"
      >
        <path
          d="M3.5 8.5 L6.5 11.5 L12.5 4.5"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </span>

    <span
      v-if="label || hint"
      class="check__text"
    >
      <span class="check__label">{{ label }}</span>
      <span
        v-if="hint"
        class="check__hint"
      >{{ hint }}</span>
    </span>
    <slot />
  </label>
</template>

<style scoped>
.check {
  display: flex;
  align-items: flex-start;
  gap: var(--gap);
  font-size: 0.8125rem;
}

.check--disabled {
  opacity: 0.5;
}

/* The real control stays, invisible but focusable and announced. */
.check__input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.check__box {
  position: relative;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 1rem;
  height: 1rem;
  margin-top: 0.0625rem;
  border-radius: 0.3125rem;
  border: 1.5px solid var(--separator-strong);
  background: color-mix(in oklab, var(--color-base-100) 60%, transparent);
  color: var(--color-primary-content);
  transition:
    background-color var(--t-press) var(--ease-out),
    border-color var(--t-press) var(--ease-out),
    transform var(--t-press) var(--ease-out);
}

.check:active .check__box {
  transform: scale(0.9);
}

.check__input:checked + .check__box {
  background: var(--color-primary);
  border-color: var(--color-primary);
}

.check__input:focus-visible + .check__box {
  outline: 2px solid color-mix(in oklab, var(--color-primary) 55%, transparent);
  outline-offset: 2px;
}

.check__tick {
  width: 0.875rem;
  height: 0.875rem;
}

/*
 * The tick is drawn on. 22 is a little more than the path length, so the dash
 * fully clears the stroke when offset.
 */
.check__tick path {
  stroke-dasharray: 22;
  stroke-dashoffset: 22;
  transition: stroke-dashoffset 200ms var(--ease-out);
}

.check__input:checked + .check__box .check__tick path {
  stroke-dashoffset: 0;
}

.check__text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

/* The line the hint is a footnote to, and the only one that has to be read. */
.check__label {
  line-height: 1.3;
}

.check__hint {
  font-size: 0.6875rem;
  color: color-mix(in oklab, var(--color-base-content) 52%, transparent);
}

@media (hover: hover) and (pointer: fine) {
  .check:hover .check__box {
    border-color: var(--separator-strong);
  }

  .check:hover .check__input:checked + .check__box {
    border-color: var(--color-primary);
  }
}

@media (prefers-reduced-motion: reduce) {
  .check__box,
  .check__tick path {
    transition-duration: 120ms;
  }

  .check:active .check__box {
    transform: none;
  }
}
</style>
