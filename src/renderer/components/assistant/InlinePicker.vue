<script setup lang="ts">
/**
 * A choice that reads as a word, not as a form field.
 *
 * The scope and the provider used to be two `SelectMenu`s in a bar above the
 * conversation. That was wrong twice over: a select is a *field*, drawn with a
 * border and a fill because it is something you fill in, and two of them side
 * by side stretched to fill a toolbar that had nothing else in it — half the
 * width of the window spent on two settings that are set once and then read.
 *
 * Here they are labels with a caret, on the floor of the composer, where the
 * question is typed. Quiet until pointed at. That is the right loudness for
 * something you check rather than operate, and it puts what the assistant can
 * see next to the box where you ask it something — the two facts belong to each
 * other, and proximity is how an interface says so.
 *
 * The menu itself is the app's own `ContextMenu`: anchored at this control,
 * flipped at an edge, dismissed through the shared stack. A second popup
 * implementation for the sake of a different trigger would be a second set of
 * all those behaviours to keep right.
 */
import { computed, ref } from 'vue';
import type { AiDriverKind } from '@shared/ai';
import ContextMenu, { type MenuItem } from '../ui/ContextMenu.vue';
import AppIcon from '../ui/AppIcon.vue';
import ProviderMark from './ProviderMark.vue';

const props = defineProps<{
  options: readonly MenuItem[];
  /** What is chosen, matched against the options' ids. */
  modelValue: string;
  ariaLabel: string;
  /** Drawn before the label when there is no driver to draw instead. */
  icon?: string;
  /**
   * Whose mark to draw on the control.
   *
   * The point of the row is which company is about to be sent the question, so
   * the control says which one — a sparkle here named the feature, which the
   * reader can already see they are using.
   */
  driver?: AiDriverKind;
  /** Shown when the chosen id matches nothing, e.g. nothing configured yet. */
  placeholder?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [string]; choose: [string] }>();

const trigger = ref<HTMLElement>();
const open = ref(false);
const at = ref({ x: 0, y: 0 });

const label = computed(
  () =>
    props.options.find((option) => option.id === props.modelValue)?.label ??
    props.placeholder ??
    ''
);

/**
 * Opened from the control's own corner rather than the pointer.
 *
 * A context menu appears where you clicked because that is the only thing it is
 * anchored to. This has a box, so it grows out of that box — and upward, since
 * the composer sits at the foot of the window and a menu below it would open
 * off the bottom edge.
 */
function toggle(): void {
  const box = trigger.value?.getBoundingClientRect();
  if (box) at.value = { x: box.left, y: box.top - 4 };
  open.value = !open.value;
}

function choose(id: string): void {
  emit('update:modelValue', id);
  emit('choose', id);
}
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="picker"
    :class="{ 'picker--open': open }"
    :aria-label="ariaLabel"
    :aria-haspopup="true"
    :aria-expanded="open"
    @click="toggle"
  >
    <ProviderMark v-if="driver" class="picker__mark" :driver="driver" :size="12" />
    <AppIcon v-else-if="icon" class="picker__mark" :name="icon" filled :size="12" />
    <span class="picker__label">{{ label }}</span>
    <AppIcon class="picker__caret" name="chevron" :size="10" />
  </button>

  <ContextMenu v-model="open" :items="options" :at="at" @choose="choose">
    <!-- Forwarded only when a caller has one, so the menu keeps its own
         fallback for every other list in the app. -->
    <template v-if="$slots.icon" #icon="slotProps">
      <slot name="icon" v-bind="slotProps" />
    </template>
  </ContextMenu>
</template>

<style scoped>
.picker {
  display: inline-flex;
  align-items: center;
  gap: var(--gap-tight);
  max-width: 14rem;
  height: var(--hit-min);
  padding-inline: var(--gap-tight);
  border-radius: var(--radius-field);
  font-size: 0.75rem;
  color: var(--text-soft);
  transition:
    background-color var(--t-hover) var(--ease-out),
    color var(--t-hover) var(--ease-out);
}

.picker:hover,
.picker--open {
  background: var(--fill-2);
  color: var(--color-base-content);
}

.picker__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker__mark {
  flex: 0 0 auto;
  color: var(--color-primary-text, var(--color-primary));
}

.picker__caret {
  flex: 0 0 auto;
  opacity: 0.5;
  /* Points down at rest and up while the menu is above it, so the control says
     where the list went. */
  transition: transform var(--t-hover) var(--ease-out);
  transform: rotate(90deg);
}

.picker--open .picker__caret {
  transform: rotate(-90deg);
}

@media (prefers-reduced-motion: reduce) {
  .picker,
  .picker__caret {
    transition: none;
  }
}
</style>
