<script setup lang="ts">
/**
 * A menu opened at a point.
 *
 * The class is `popmenu`: daisyUI owns `.menu` and dresses its list items, so a
 * component of ours taking that name inherits a second set of paddings and
 * hovers on top of the ones it drew.
 *
 * Anchored where it was summoned from rather than at a fixed corner: it scales
 * out of the pointer, so the relationship between what you clicked and what
 * appeared is stated by the motion instead of having to be inferred.
 *
 * Teleported, because the sidebar it is usually summoned from is a scrolling
 * box with `overflow: hidden` — a menu rendered inside it would be clipped by
 * the very row it belongs to.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useDismiss } from '../../composables/useDismiss';
import AppIcon from './AppIcon.vue';

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  /** Drawn before the label, if the action has an icon in the set. */
  readonly icon?: string;
  readonly disabled?: boolean;
  /** Separated from what came before it. */
  readonly startsGroup?: boolean;
  /**
   * The keystroke that does the same thing, at the end of the row.
   *
   * A menu is where people find out an action exists; a shortcut beside it is
   * how they stop needing the menu. Right-aligned and quiet, because it is a
   * fact about the row rather than part of what the row says.
   */
  readonly hint?: string;
}

const props = defineProps<{
  items: readonly MenuItem[];
  /** Where the pointer was, in viewport coordinates. */
  at: { x: number; y: number };
  /**
   * The control that opens this menu, when there is one.
   *
   * A menu opened from a *button* has to close when that button is pressed
   * again, and it could not: dismissal happens at the window in the capture
   * phase, so the press closed the menu before the button's own click handler
   * ran and the handler then opened it straight back up. Pressing twice looked
   * like pressing nothing.
   *
   * Naming the trigger lets the dismisser leave it alone, so the button's
   * handler sees the state the reader saw and can simply toggle. A menu opened
   * at a pointer — a right-click — has no trigger and wants none.
   */
  trigger?: HTMLElement | null;
}>();

const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ choose: [string] }>();

const panel = ref<HTMLElement>();
/*
 * Nothing is highlighted until the pointer or the keyboard picks something. A
 * menu that opens with its first item already lit looks like it has decided for
 * you, and on a right-click — where the pointer is nowhere near that row — it
 * reads as a misplaced hover.
 */
const active = ref(-1);
/** Resolved after mount, once the menu has a size to flip against. */
const placement = ref({ left: 0, top: 0, origin: 'top left' });

const enabled = computed(() => props.items.filter((item) => !item.disabled));

/**
 * Placed at the pointer, flipped rather than clamped at an edge.
 *
 * Clamping slides the menu sideways until it fits, which leaves it sitting on
 * top of the thing you clicked. Flipping keeps the corner nearest the pointer
 * pinned and grows the menu the other way, which is what every desktop menu
 * does and what the transform origin then matches.
 */
function place(): void {
  const box = panel.value?.getBoundingClientRect();
  if (!box) return;

  const margin = 8;
  const flipX = props.at.x + box.width + margin > globalThis.innerWidth;
  const flipY = props.at.y + box.height + margin > globalThis.innerHeight;

  placement.value = {
    left: flipX ? Math.max(margin, props.at.x - box.width) : props.at.x,
    top: flipY ? Math.max(margin, props.at.y - box.height) : props.at.y,
    origin: `${flipY ? 'bottom' : 'top'} ${flipX ? 'right' : 'left'}`,
  };
}

function move(delta: number): void {
  const count = enabled.value.length;
  if (count === 0) return;
  // From nothing, Down lands on the first item and Up on the last.
  if (active.value < 0) active.value = delta > 0 ? 0 : count - 1;
  else active.value = (active.value + delta + count) % count;
}

function choose(item: MenuItem): void {
  if (item.disabled) return;
  open.value = false;
  emit('choose', item.id);
}

function commit(): void {
  const item = enabled.value[active.value];
  if (item) choose(item);
}

/*
 * Dismissal is handled at the window, in the capture phase. A menu that only
 * closes on its own click-outside handler stays up when the next click lands
 * inside a canvas, an iframe, or anything that stops propagation — which is
 * exactly when someone is trying to get rid of it. Escape is the same idea, and
 * goes through the shared stack so a menu opened over a sheet closes itself and
 * leaves the sheet standing.
 */
function onWindowPointerDown(event: PointerEvent): void {
  if (!open.value) return;
  if (panel.value?.contains(event.target as Node)) return;
  // The control that opened it closes it itself, on the click that follows.
  if (props.trigger?.contains(event.target as Node)) return;
  open.value = false;
}

watch(open, async (isOpen) => {
  if (!isOpen) return;

  active.value = -1;
  await nextTick();
  place();
  panel.value?.focus();
});

watch(() => props.at, place);

useDismiss(open);

globalThis.addEventListener('pointerdown', onWindowPointerDown, true);

onBeforeUnmount(() => {
  globalThis.removeEventListener('pointerdown', onWindowPointerDown, true);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="menu">
      <div
        v-if="open"
        ref="panel"
        class="popmenu surface-popover"
        role="menu"
        tabindex="-1"
        :style="{
          left: `${placement.left}px`,
          top: `${placement.top}px`,
          transformOrigin: placement.origin,
        }"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="commit"
        @keydown.space.prevent="commit"
      >
        <template v-for="item in items" :key="item.id">
          <hr v-if="item.startsGroup" class="popmenu__rule" />
          <button
            type="button"
            class="popmenu__item"
            :class="{ 'popmenu__item--active': enabled[active]?.id === item.id }"
            role="menuitem"
            :disabled="item.disabled"
            @pointerenter="
              !item.disabled &&
              (active = enabled.findIndex((candidate) => candidate.id === item.id))
            "
            @click="choose(item)"
          >
            <AppIcon v-if="item.icon" class="popmenu__icon" :name="item.icon" :size="12" />
            <span class="popmenu__label">{{ item.label }}</span>
            <kbd v-if="item.hint" class="popmenu__hint">{{ item.hint }}</kbd>
          </button>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.popmenu {
  position: fixed;
  z-index: 200;
  min-width: 12rem;
  padding: var(--gap-tight);
  border-radius: 0.75rem;
  outline: none;
}

.popmenu__item {
  display: flex;
  align-items: center;
  gap: var(--gap);
  width: 100%;
  height: var(--hit-min);
  padding-inline: var(--gap);
  border-radius: var(--radius-field);
  font-size: 0.8125rem;
  text-align: start;
  color: var(--color-base-content);
}

/*
 * One highlight, driven by the keyboard cursor and moved by hover, so pointer
 * and keyboard cannot both claim a row at once — two highlighted items is the
 * classic menu bug and it is entirely a question of having two states.
 */
.popmenu__item--active:not(:disabled) {
  background-color: color-mix(in oklab, var(--color-primary) 16%, transparent);
  color: var(--color-primary-text, var(--color-primary));
}

.popmenu__item:disabled {
  opacity: 0.4;
}

.popmenu__icon {
  flex: 0 0 auto;
  opacity: 0.7;
}

.popmenu__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * At the end of the row, in the same tabular figures the rest of the app sets
 * keys in. Quiet enough that the eye reads the label first and finds this only
 * when it is looking for it, which is the moment it becomes useful.
 */
.popmenu__hint {
  flex: 0 0 auto;
  margin-inline-start: var(--gap-loose);
  font-family: inherit;
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  color: color-mix(in oklab, var(--color-base-content) 38%, transparent);
}

.popmenu__rule {
  height: 1px;
  margin: var(--gap-tight) var(--gap);
  border: 0;
  background: var(--separator);
}

/* Out of the pointer, not out of nowhere. */
.menu-enter-active,
.menu-leave-active {
  transition:
    transform 160ms var(--ease-out),
    opacity 120ms var(--ease-out);
}

.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: scale(0.94);
}

@media (prefers-reduced-motion: reduce) {
  .menu-enter-from,
  .menu-leave-to {
    transform: none;
  }
}
</style>
