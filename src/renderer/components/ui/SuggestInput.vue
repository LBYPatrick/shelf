<script setup lang="ts">
/**
 * A field you type into, with a list of the answers most people want.
 *
 * The model name on the provider editor is the case this exists for, and it is
 * genuinely both things: the four names we ship for a driver cover almost
 * everyone, and anyone pointing this at a local server has a model name we have
 * never heard of. A select would lock them out; a bare text field makes the
 * common case an act of remembering an exact string.
 *
 * It was a `<datalist>`, which is the platform's answer to exactly this and is
 * unusable for one reason: the popup is drawn by the engine and cannot be
 * styled at all. Over a sheet built from these tokens it opened a white box
 * with a black triangle and a bold-matched line in it — the same defect the
 * native `<select>` has, which is why `SelectMenu` exists. So this is the same
 * list that control opens, sharing its placement, its dismissal and its
 * `menulist` styling: two controls, one list.
 *
 * Typing filters. Not because the lists are long — they are three or four names
 * — but because a list that ignores what has been typed leaves the reader
 * scanning for a line the field already knows the answer to.
 */
import { computed, nextTick, ref } from 'vue';
import { useDismiss } from '../../composables/useDismiss';
import { listStyle, useAnchoredList } from '../../composables/useAnchoredList';
import AppIcon from './AppIcon.vue';

const props = defineProps<{
  options: readonly string[];
  ariaLabel?: string;
  id?: string;
  placeholder?: string;
  /** Monospace, for the things that are identifiers rather than words. */
  monospace?: boolean;
}>();

const model = defineModel<string>({ required: true });

const open = ref(false);

/* Through the shared stack, so this inside a sheet gives the sheet back rather
   than closing with it. */
useDismiss(open);

const root = ref<HTMLElement>();
const list = ref<HTMLElement>();
const field = ref<HTMLInputElement>();
/** Which option the keyboard is on, which is not yet which one is chosen. */
const active = ref(0);

/**
 * What is offered, given what has been typed.
 *
 * A value that matches nothing shows the whole list rather than an empty popup:
 * a name we do not know is the normal case for a local server, and answering it
 * with "no matches" reads as the field rejecting what was typed.
 */
const shown = computed(() => {
  const needle = model.value.trim().toLowerCase();
  if (!needle) return props.options;
  const matched = props.options.filter((option) => option.toLowerCase().includes(needle));
  return matched.length > 0 ? matched : props.options;
});

function onPointerDown(event: PointerEvent): void {
  const target = event.target as Node;
  if (root.value?.contains(target) || list.value?.contains(target)) return;
  open.value = false;
}

const { placement, reposition } = useAnchoredList(
  open,
  () => root.value?.querySelector<HTMLElement>('.suggest__field'),
  onPointerDown
);

function scrollToActive(): void {
  void nextTick(() => {
    list.value?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({
      block: 'nearest',
    });
  });
}

function show(): void {
  const at = shown.value.indexOf(model.value);
  active.value = Math.max(0, at);
  reposition();
  open.value = true;
  scrollToActive();
}

function choose(index: number): void {
  const option = shown.value[index];
  if (option === undefined) return;
  model.value = option;
  open.value = false;
  field.value?.focus();
}

function move(delta: number): void {
  if (!open.value) {
    show();
    return;
  }
  const count = shown.value.length;
  if (count === 0) return;
  active.value = (active.value + delta + count) % count;
  scrollToActive();
}

/**
 * Enter picks the highlighted line while the list is up, and otherwise does
 * nothing here — a field inside a form has an Enter of its own, and swallowing
 * it when there is no list to pick from would break submitting.
 */
function onEnter(event: KeyboardEvent): void {
  if (!open.value) return;
  event.preventDefault();
  choose(active.value);
}

/**
 * A press on the field shows the list; a second press inside it does not take
 * it away again.
 *
 * Opening on *focus* would be the obvious place and is wrong: tabbing through a
 * form would pop a list at every field on the way past. A click is deliberate,
 * and toggling on it would mean a click to put the caret somewhere — which is
 * the other thing clicks in a text field are for — closing the list the last
 * click opened.
 */
function onClick(): void {
  if (!open.value) show();
}

function onInput(): void {
  active.value = 0;
  if (!open.value) show();
  else reposition();
}
</script>

<template>
  <div ref="root" class="suggest">
    <input
      :id="id"
      ref="field"
      v-model="model"
      class="suggest__field textfield"
      :class="{ 'textfield--mono': monospace }"
      type="text"
      role="combobox"
      :aria-expanded="open"
      :aria-label="ariaLabel"
      aria-autocomplete="list"
      :aria-controls="open ? `${id ?? 'suggest'}-list` : undefined"
      :placeholder="placeholder"
      spellcheck="false"
      autocomplete="off"
      @input="onInput"
      @click="onClick"
      @keydown.down.prevent="move(1)"
      @keydown.up.prevent="move(-1)"
      @keydown.enter="onEnter"
    />

    <!--
      A button, not a glyph. The whole point of the list is that it can be
      opened without knowing what is in it, and a decoration that opens on click
      is a control that has not been told it is one.
    -->
    <button
      type="button"
      class="suggest__open"
      tabindex="-1"
      :aria-label="$t('action.showSuggestions')"
      @click="open ? (open = false) : show()"
    >
      <AppIcon
        class="suggest__chevron"
        :class="{ 'suggest__chevron--open': open }"
        name="chevron"
        :size="11"
      />
    </button>

    <Teleport to="body">
      <ul
        v-if="open && shown.length > 0"
        :id="`${id ?? 'suggest'}-list`"
        ref="list"
        class="menulist surface-popover"
        :class="{ 'menulist--above': placement.above }"
        :style="listStyle(placement)"
        role="listbox"
        :aria-label="ariaLabel"
      >
        <li
          v-for="(option, index) in shown"
          :key="option"
          class="menulist__option suggest__option"
          :class="{ 'menulist__option--active': index === active }"
          :data-active="index === active"
          role="option"
          :aria-selected="option === model"
          @pointerenter="active = index"
          @click="choose(index)"
        >
          <AppIcon
            class="menulist__tick"
            :class="{ 'menulist__tick--on': option === model }"
            name="check"
            :size="12"
          />
          <span>{{ option }}</span>
        </li>
      </ul>
    </Teleport>
  </div>
</template>

<style scoped>
.suggest {
  position: relative;
  width: 100%;
}

/* The chevron's room, reserved on the field so a long name runs under it rather
   than behind it. */
.suggest__field {
  width: 100%;
  padding-inline-end: var(--hit-min);
}

.suggest__open {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  display: grid;
  place-items: center;
  width: var(--hit-min);
  border-radius: var(--control-radius);
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
}

.suggest__open:hover {
  color: var(--color-base-content);
}

/* The shared chevron points right, as a disclosure twisty does; one that opens
   a list points down at rest and flips up while the list is showing — the same
   rule the select follows. */
.suggest__chevron {
  transform: rotate(90deg);
  transition: transform var(--t-pop) var(--ease-sheet);
}

.suggest__chevron--open {
  transform: rotate(-90deg);
}

/* The names in this list are identifiers, and are set as such. */
.suggest__option span {
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

@media (prefers-reduced-motion: reduce) {
  .suggest__chevron {
    transition: none;
  }
}
</style>
