<script setup lang="ts">
/**
 * A text input.
 *
 * Everything it looks like is the `.field` recipe in `styles/controls.css`, so
 * a text field, a number field and a select are one shape rather than three
 * that happen to agree. It carries no class of its own beyond that.
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
    class="textfield"
    :class="{ 'textfield--invalid': invalid, 'textfield--mono': monospace }"
    :type="type"
    :placeholder="placeholder"
    :disabled="disabled"
    :aria-invalid="invalid || undefined"
    spellcheck="false"
    autocomplete="off"
  >
</template>
