<script setup lang="ts" generic="T extends string">
/**
 * A select.
 *
 * The root class is `selectmenu`, not `select`: daisyUI ships a `.select`
 * component, and wearing that name meant it drew its own border, its own fixed
 * height, a `width: clamp(3rem, 20rem, 100%)` and a background-image arrow on
 * top of ours — a box inside a box with two chevrons in it.
 *
 * The native control is not usable here, and not because of how it looks at
 * rest: its *popup* is drawn by the operating system and cannot be styled at
 * all. Setting `appearance: none` restyles the closed control and leaves the
 * open one a native list — so the app looked finished until you clicked it, at
 * which point a system menu opened over the sheet with its own focus ring, its
 * own selection colour and its own idea of where the list should be positioned.
 *
 * So the list is ours: a real listbox, keyboard-driven, that scales from the
 * control it belongs to rather than appearing at the pointer.
 */
import { computed, nextTick, ref } from 'vue';
import { useDismiss } from '../../composables/useDismiss';
import { listStyle, useAnchoredList } from '../../composables/useAnchoredList';
import AppIcon from './AppIcon.vue';

const props = defineProps<{
  options: readonly { value: T; label: string }[];
  ariaLabel?: string;
  id?: string;
}>();

const model = defineModel<T>({ required: true });

const open = ref(false);

/*
 * Through the shared stack, so a select inside a sheet gives the sheet back
 * rather than closing with it. Its own `@keydown.esc` only worked while the
 * trigger had focus, which it does not once the list is up.
 */
useDismiss(open);
const root = ref<HTMLElement>();
const list = ref<HTMLElement>();
/** Which option the keyboard is on, which is not yet which one is chosen. */
const active = ref(0);

const selectedIndex = computed(() => props.options.findIndex((o) => o.value === model.value));
const label = computed(() => props.options[selectedIndex.value]?.label ?? '');

function onPointerDown(event: PointerEvent): void {
  const target = event.target as Node;
  // The list is no longer inside the control, so "did the press land on me"
  // has to ask both.
  if (root.value?.contains(target) || list.value?.contains(target)) return;
  open.value = false;
}

const { placement, reposition } = useAnchoredList(
  open,
  () => root.value?.querySelector<HTMLElement>('.select__trigger'),
  onPointerDown
);

function show(): void {
  active.value = Math.max(0, selectedIndex.value);
  reposition();
  open.value = true;
  void nextTick(() => {
    list.value?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({
      block: 'nearest',
    });
  });
}

function choose(index: number): void {
  const option = props.options[index];
  if (!option) return;
  model.value = option.value;
  open.value = false;
  root.value?.querySelector<HTMLElement>('.select__trigger')?.focus();
}

function move(delta: number): void {
  if (!open.value) {
    show();
    return;
  }
  active.value = (active.value + delta + props.options.length) % props.options.length;
  void nextTick(() => {
    list.value?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({
      block: 'nearest',
    });
  });
}
</script>

<template>
  <div ref="root" class="selectmenu">
    <button
      :id="id"
      type="button"
      class="select__trigger focus-fill"
      role="combobox"
      :aria-expanded="open"
      :aria-label="ariaLabel"
      aria-haspopup="listbox"
      :aria-controls="open ? `${id ?? 'select'}-list` : undefined"
      @click="open ? (open = false) : show()"
      @keydown.down.prevent="move(1)"
      @keydown.up.prevent="move(-1)"
      @keydown.enter.prevent="open ? choose(active) : show()"
      @keydown.space.prevent="open ? choose(active) : show()"
    >
      <span class="select__label">{{ label }}</span>
      <AppIcon
        class="select__chevron"
        :class="{ 'select__chevron--open': open }"
        name="chevron"
        :size="11"
      />
    </button>

    <Teleport to="body">
      <ul
        v-if="open"
        :id="`${id ?? 'select'}-list`"
        ref="list"
        class="menulist surface-popover"
        :class="{ 'menulist--above': placement.above }"
        :style="listStyle(placement)"
        role="listbox"
        :aria-label="ariaLabel"
      >
        <li
          v-for="(option, index) in options"
          :key="option.value"
          class="menulist__option"
          :class="{ 'menulist__option--active': index === active }"
          :data-active="index === active"
          role="option"
          :aria-selected="option.value === model"
          @pointerenter="active = index"
          @click="choose(index)"
        >
          <AppIcon
            class="menulist__tick"
            :class="{ 'menulist__tick--on': option.value === model }"
            name="check"
            :size="12"
          />
          <span>{{ option.label }}</span>
        </li>
      </ul>
    </Teleport>
  </div>
</template>

<style scoped>
.selectmenu {
  position: relative;
  width: 100%;
}

.select__trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap);
  width: 100%;
  min-height: var(--field-h);
  padding-inline: var(--gap-loose) var(--gap);
  border: 1px solid transparent;
  border-radius: var(--control-radius);
  background-color: var(--fill-3);
  color: var(--color-base-content);
  font-size: 0.8125rem;
  text-align: start;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    transform 0.12s cubic-bezier(0.32, 0.72, 0, 1);
}

.select__trigger:active {
  transform: scale(0.99);
}

.select__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The shared chevron points right, as a disclosure twisty does; a select's
   points down at rest and flips up when the list is showing. */
.select__chevron {
  flex: 0 0 auto;
  opacity: 0.45;
  transform: rotate(90deg);
  transition: transform 200ms cubic-bezier(0.32, 0.72, 0, 1);
}

.select__chevron--open {
  transform: rotate(-90deg);
}

@media (hover: hover) and (pointer: fine) {
  .select__trigger:hover {
    background-color: var(--fill-2);
  }
}

@media (prefers-reduced-motion: reduce) {
  .select__chevron {
    transition: none;
  }
}
</style>
