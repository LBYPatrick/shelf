<script setup lang="ts">
/**
 * A labelled field.
 *
 * The label is bound to the control through a generated id, so clicking the
 * label focuses the input and a screen reader announces the two together. The
 * id is handed to the default slot rather than guessed at, which keeps the
 * association correct however the control is composed.
 *
 * The label sits above the control so a long label never squeezes the input,
 * and the help text sits directly beneath the thing it explains — proximity is
 * what creates the association, without needing a line to connect them.
 */
import { useId } from 'vue';

defineProps<{ label: string; help?: string; error?: string }>();

const id = useId();
const describedBy = `${id}-note`;
</script>

<template>
  <div class="field">
    <label class="type-label field__label" :for="id">{{ label }}</label>

    <slot :id="id" :described-by="error || help ? describedBy : undefined" />

    <p v-if="error" :id="describedBy" class="field__note field__note--error" role="alert">
      {{ error }}
    </p>
    <p v-else-if="help" :id="describedBy" class="field__note">
      {{ help }}
    </p>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
  min-width: 0;
}

.field__label {
  color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
}

.field__note {
  font-size: 0.6875rem;
  line-height: 1.35;
  color: color-mix(in oklab, var(--color-base-content) 52%, transparent);
}

.field__note--error {
  color: var(--color-error);
}
</style>
