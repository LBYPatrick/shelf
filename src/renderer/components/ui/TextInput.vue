<script setup lang="ts">
/**
 * A text input sized to the density scale. Focus is shown with a ring rather
 * than a colour change so it stays visible against every accent and in high
 * contrast mode.
 */
withDefaults(
  defineProps<{
    type?: 'text' | 'password' | 'number';
    placeholder?: string;
    invalid?: boolean;
    disabled?: boolean;
    monospace?: boolean;
  }>(),
  {
    type: 'text',
    placeholder: undefined,
    invalid: false,
    disabled: false,
    monospace: false,
  }
);

const model = defineModel<string | number | undefined>();
</script>

<template>
  <input
    v-model="model"
    class="input"
    :class="{ 'input--invalid': invalid, 'input--mono': monospace }"
    :type="type"
    :placeholder="placeholder"
    :disabled="disabled"
    :aria-invalid="invalid || undefined"
    spellcheck="false"
    autocomplete="off"
  >
</template>

<style scoped>
.input {
  height: var(--field-h);
  min-width: 0;
  padding-inline: var(--gap);
  border-radius: var(--radius-field);
  border: 1px solid color-mix(in oklab, var(--color-base-content) 14%, transparent);
  background: color-mix(in oklab, var(--color-base-100) 80%, transparent);
  color: var(--color-base-content);
  font-size: 0.8125rem;
  /* A hairline of inner shadow reads as a recess rather than a drawn outline. */
  box-shadow: inset 0 1px 2px oklch(0% 0 0 / 0.05);
  transition:
    border-color var(--t-hover) var(--ease-out),
    background-color var(--t-hover) var(--ease-out),
    box-shadow var(--t-hover) var(--ease-out);
}

.input--mono {
  font-family: var(--font-mono);
}

.input::placeholder {
  color: color-mix(in oklab, var(--color-base-content) 38%, transparent);
}

.input:focus {
  border-color: var(--color-primary);
  background: var(--color-base-100);
  outline: none;
  /* The ring sits outside the recess, so focus reads as the field lifting. */
  box-shadow:
    inset 0 1px 2px oklch(0% 0 0 / 0.03),
    0 0 0 3px color-mix(in oklab, var(--color-primary) 24%, transparent);
}

@media (hover: hover) and (pointer: fine) {
  .input:hover:not(:disabled):not(:focus) {
    border-color: color-mix(in oklab, var(--color-base-content) 26%, transparent);
  }
}

.input--invalid {
  border-color: var(--color-error);
}

.input:disabled {
  opacity: 0.5;
}
</style>
