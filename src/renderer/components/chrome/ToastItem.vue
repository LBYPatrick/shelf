<script setup lang="ts">
/**
 * One notice.
 *
 * A sentence on a popover surface with one coloured mark in front of it. The
 * tone is carried by that mark and — for the two that are not merely status —
 * by a hairline; flooding the surface with the tone puts the text on colour and
 * takes the material with it.
 *
 * It owns its own expiry so the countdown can pause. A message that leaves
 * while you are reaching for its action button is a message you were not
 * offered, and the same is true of one that ran out while you were in another
 * application — which is the common case here, because the work that raises
 * these runs in the background.
 *
 * **It can be thrown away.** Dragging horizontally moves it one to one with the
 * pointer and fades it as it goes; let go where the momentum would carry it
 * past 80% of its own width and it goes, and anything short of that springs
 * back. A close button is a small target reached by aiming; a swipe is a
 * gesture, and for something you are dismissing rather than reading it is the
 * better of the two.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Toast } from '../../stores/toasts';
import { useDrag } from '../../composables/useDrag';
import AppIcon from '../ui/AppIcon.vue';

const props = defineProps<{ notice: Toast }>();
const emit = defineEmits<{ dismiss: [] }>();

const ICON: Record<Toast['tone'], string> = {
  info: 'info',
  success: 'check',
  warning: 'warning',
  error: 'warning',
};

/*
 * A failure is an alert and gets read out of turn; the rest are status and wait
 * their turn. Saying everything urgently is the same as saying nothing is.
 */
const live = computed(() =>
  props.notice.tone === 'error' || props.notice.tone === 'warning' ? 'alert' : 'status'
);

/* -------------------------------------------------------------------- swipe */

/** How far across its own width a throw has to be headed to count as one. */
const THROW = 0.8;

const root = ref<HTMLElement>();
const offset = ref(0);

/**
 * How far a swipe has got, as a fraction, for the fade.
 *
 * Fading with the distance rather than at the threshold is what makes the
 * gesture answer: at a third of the way across you can see both that it is
 * moving and that letting go now would not be enough.
 */
const fade = computed(() => {
  const width = root.value?.offsetWidth ?? 320;
  return Math.min(1, Math.abs(offset.value) / (width * THROW));
});

const { start, dragging } = useDrag({
  axis: 'x',
  getValue: () => offset.value,
  onDrag: (state) => (offset.value = state.value),
  onRelease: (state) => {
    const width = root.value?.offsetWidth ?? 320;

    /*
     * Where the flick would come to rest, not where the finger let go.
     *
     * Judging the throw on distance alone makes a quick flick fail: it is
     * released early by definition, so a gesture that plainly meant "go" is
     * answered by the card sliding back under the hand that threw it.
     * `projected` is the composable's own momentum projection, which is what it
     * computes it for.
     */
    if (Math.abs(state.projected) < width * THROW) {
      // Short of the threshold: back where it was, on the same curve
      // everything else in this app returns on.
      offset.value = 0;
      return;
    }

    /*
     * Gone at once, and left where the hand put it.
     *
     * There was a flight off the trailing edge here, dismissed on its
     * `transitionend`. It animated nothing anybody could see — the fade is tied
     * to the distance, so a card past the threshold is already fully
     * transparent — while holding its place in the column for the length of it,
     * so the gap took a fifth of a second to close after a gesture that had
     * finished. Worse, under `prefers-reduced-motion` `base.css` takes
     * `transform` out of `transition-property` altogether: the event never
     * fired, and a thrown notice stayed in the list, invisible, for good.
     */
    emit('dismiss');
  },
});

function onGrab(event: PointerEvent): void {
  // Not from the close button or the action: those are targets, and a press on
  // a target that also starts a drag is a target that misfires when the hand
  // moves two pixels.
  if ((event.target as HTMLElement).closest('button')) return;
  start(event);
}

/* ---------------------------------------------------------------- countdown */

const hovered = ref(false);

/**
 * Whether the window is the one being looked at.
 *
 * react-toastify calls this `pauseOnFocusLoss`, and it matters here more than
 * on a web page: this app raises notices from work that runs in the background,
 * so the common case for "an export finished" is that nobody was looking when
 * it did.
 */
const blurred = ref(typeof document !== 'undefined' && document.visibilityState === 'hidden');

function onWindowBlur(): void {
  blurred.value = true;
}

function onWindowFocus(): void {
  blurred.value = false;
}

const paused = computed(() => hovered.value || blurred.value || dragging.value);

let timer: ReturnType<typeof setTimeout> | undefined;
let remaining = props.notice.expire ?? 0;
let startedAt = 0;

function hold(): void {
  if (!timer) return;
  clearTimeout(timer);
  timer = undefined;
  remaining = Math.max(0, remaining - (performance.now() - startedAt));
}

function run(): void {
  if (timer || remaining <= 0) return;
  startedAt = performance.now();
  timer = setTimeout(() => emit('dismiss'), remaining);
}

watch(paused, (held) => (held ? hold() : run()));

onMounted(() => {
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('focus', onWindowFocus);
  if (!paused.value) run();
});

onBeforeUnmount(() => {
  hold();
  window.removeEventListener('blur', onWindowBlur);
  window.removeEventListener('focus', onWindowFocus);
});

/*
 * A notice replaced in place — same id, new message — starts its life again.
 *
 * The store replaces rather than stacks, so a setting flipped four times leaves
 * one notice saying what it is now. Without this it would also carry whatever
 * was left of the *first* one's expiry, and the fourth message would go in a
 * fraction of the time the first was given.
 */
watch(
  () => props.notice.message,
  () => {
    offset.value = 0;
    hold();
    remaining = props.notice.expire ?? 0;
    if (!paused.value) run();
  }
);

function act(): void {
  props.notice.action?.run();
  emit('dismiss');
}
</script>

<template>
  <div
    ref="root"
    class="notice surface-popover"
    :class="[`notice--${notice.tone}`, { 'notice--dragging': dragging }]"
    :style="{ '--offset': `${offset}px`, '--fade': String(1 - fade) }"
    :role="live"
    @pointerdown="onGrab"
    @pointerenter="hovered = true"
    @pointerleave="hovered = false"
    @focusin="hovered = true"
    @focusout="hovered = false"
  >
    <AppIcon class="notice__mark" :name="ICON[notice.tone]" :size="14" />

    <div class="notice__body">
      <p v-if="notice.title" class="notice__title">
        {{ notice.title }}
      </p>
      <p class="notice__message">
        {{ notice.message }}
      </p>
    </div>

    <button v-if="notice.action" type="button" class="notice__action focus-fill" @click="act">
      {{ notice.action.label }}
    </button>

    <button
      type="button"
      class="notice__close focus-fill"
      :aria-label="$t('action.close')"
      @click="emit('dismiss')"
    >
      <AppIcon name="close" :size="10" />
    </button>
  </div>
</template>

<style scoped>
.notice {
  display: flex;
  align-items: center;
  gap: var(--gap);
  width: min(24rem, calc(100vw - 2rem));
  padding: var(--gap) var(--gap-tight) var(--gap) var(--gap-loose);
  border-radius: var(--radius-box);
  cursor: default;
  /* The gesture is horizontal, so the browser keeps the vertical one. */
  touch-action: pan-y;
  opacity: var(--fade, 1);
  transform: translateX(var(--offset, 0));
}

/* Under the hand it tracks one to one, so nothing is animated; released, it
   returns — or leaves — on the app's own curve. */
.notice:not(.notice--dragging) {
  transition:
    transform var(--t-pop) var(--ease-out),
    opacity var(--t-pop) var(--ease-out);
}

/*
 * The tone is carried by the mark and a hairline, not by a coloured slab. A
 * notice is a sentence on a surface; flooding the surface with the tone makes
 * the text sit on colour and takes the material with it.
 */
.notice__mark {
  flex: 0 0 auto;
  color: var(--color-base-content);
}

.notice--success .notice__mark {
  color: var(--color-success);
}

.notice--warning .notice__mark {
  color: var(--color-warning);
}

.notice--error .notice__mark {
  color: var(--color-error);
}

.notice--error,
.notice--warning {
  border: 1px solid color-mix(in oklab, var(--color-error) 30%, transparent);
}

.notice--warning {
  border-color: color-mix(in oklab, var(--color-warning) 34%, transparent);
}

.notice__body {
  flex: 1;
  min-width: 0;
}

.notice__title {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
}

.notice__message {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.35;
  color: color-mix(in oklab, var(--color-base-content) 78%, transparent);
}

.notice__action {
  flex: 0 0 auto;
  height: var(--field-h);
  padding-inline: var(--gap);
  border-radius: var(--control-radius);
  font-size: 0.75rem;
  font-weight: 550;
  color: var(--color-primary-text, var(--color-primary));
}

.notice__close {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: var(--hit-min);
  height: var(--hit-min);
  border-radius: var(--control-radius);
  color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
}

@media (hover: hover) and (pointer: fine) {
  .notice__action:hover,
  .notice__close:hover {
    background: var(--fill-4);
  }

  .notice__close:hover {
    color: var(--color-base-content);
  }
}

/*
 * Reduced motion is answered in `base.css`, not here: its global rule takes
 * `transform` out of `transition-property`, so the card still tracks the hand
 * — the drag sets the transform directly — and simply stops springing back.
 */
</style>
