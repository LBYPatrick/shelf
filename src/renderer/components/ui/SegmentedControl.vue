<script setup lang="ts" generic="T extends string">
/**
 * A segmented control whose selection indicator travels between options rather
 * than blinking from one to the other. The movement is what tells you the two
 * options belong to the same axis of choice.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{
  options: readonly { value: T; label: string }[];
  ariaLabel: string;
}>();

const model = defineModel<T>({ required: true });

const container = ref<HTMLElement>();
const indicator = ref({ left: 0, width: 0, visible: false });

const selectedIndex = computed(() => props.options.findIndex((o) => o.value === model.value));

function measure(): void {
  const root = container.value;
  if (!root) return;

  const button = root.querySelectorAll<HTMLElement>('[data-segment]')[selectedIndex.value];
  if (!button) {
    indicator.value = { ...indicator.value, visible: false };
    return;
  }

  indicator.value = {
    left: button.offsetLeft,
    width: button.offsetWidth,
    visible: true,
  };
}

watch([selectedIndex, () => props.options], measure, { flush: 'post', immediate: true });

/*
 * A control built inside a closed sheet measures its options against a
 * zero-width box, so the indicator came out 0px wide and the selected segment
 * appeared to have no indicator at all. Observing the track re-measures the
 * moment it is shown, and again whenever the sheet is resized or the language
 * changes the width of every label.
 */
let observer: ResizeObserver | undefined;

onMounted(() => {
  observer = new ResizeObserver(() => measure());
  if (container.value) observer.observe(container.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = undefined;
});
</script>

<template>
  <div
    ref="container"
    class="segmented"
    role="radiogroup"
    :aria-label="ariaLabel"
    @keydown.left.prevent="
      model = options[(selectedIndex - 1 + options.length) % options.length]!.value
    "
    @keydown.right.prevent="model = options[(selectedIndex + 1) % options.length]!.value"
  >
    <span
      v-show="indicator.visible"
      class="segmented__indicator"
      :style="{ transform: `translateX(${indicator.left}px)`, width: `${indicator.width}px` }"
      aria-hidden="true"
    />
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      data-segment
      class="segmented__option"
      role="radio"
      :aria-checked="model === option.value"
      :tabindex="model === option.value ? 0 : -1"
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
/*
 * One padding token drives the track's inset, the indicator's inset and the
 * inner radius, so the two shapes stay concentric instead of each hardcoding
 * pixels that then have to be kept in agreement by hand.
 */
/*
 * Sized to its options, never stretched. Laid out as a flex child it would
 * stretch to the row and leave the thumb sitting in a long empty track — which
 * reads as a progress bar with a label on it rather than as a choice between
 * three things.
 */
.segmented {
  --seg-pad: 3px;
  --seg-radius: 10px;
  position: relative;
  display: inline-flex;
  align-self: flex-start;
  width: fit-content;
  padding: var(--seg-pad);
  border-radius: var(--seg-radius);
  /*
   * The same fill a grey button wears. A segmented track and a button beside it
   * on the same bar are the same material, and hand-picked percentages are
   * exactly why those two never used to match.
   */
  background-color: var(--fill-3);
}

/*
 * The whole track tints on focus, not the focused segment: the segment already
 * carries the raised indicator when it is the chosen one, so tinting it would
 * conflate "chosen" with "focused".
 */
.segmented:has(:focus-visible) {
  background-image: linear-gradient(var(--focus-fill), var(--focus-fill));
}

.segmented__indicator {
  position: absolute;
  inset-block: var(--seg-pad);
  left: 0;
  border-radius: calc(var(--seg-radius) - var(--seg-pad));
  /*
   * White in light, a grey *lighter than its own track* in dark. Deriving both
   * from the text colour is what made this invisible: on the dark theme
   * base-content is near-white, so track and thumb landed within a few points
   * of lightness of each other.
   */
  background-color: var(--control-thumb);
  /* No border: the shadow does the lifting, and a hairline was doing the same
     job twice and thickening the capsule by 2px. */
  box-shadow: var(--elev-thumb);
  transition:
    transform 260ms cubic-bezier(0.32, 0.72, 0, 1),
    width 260ms cubic-bezier(0.32, 0.72, 0, 1),
    opacity 140ms ease;
}

.segmented__option {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  height: var(--hit-min);
  padding-inline: 0.75rem;
  border-radius: calc(var(--seg-radius) - var(--seg-pad));
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: -0.003em;
  white-space: nowrap;
  color: color-mix(in oklab, var(--color-base-content) 58%, transparent);
  transition: color var(--t-hover) var(--ease-out);
}

/* The track carries the single focus indicator, so the segments suppress
   their own. */
.segmented__option:focus-visible {
  outline: none;
}

.segmented__option[aria-checked='true'] {
  color: var(--color-base-content);
  font-weight: 550;
}

@media (hover: hover) and (pointer: fine) {
  .segmented__option:not([aria-checked='true']):hover {
    color: color-mix(in oklab, var(--color-base-content) 85%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .segmented__indicator {
    transition: opacity 140ms ease;
  }
}
</style>
