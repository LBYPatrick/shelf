<script setup lang="ts">
/**
 * One notice, built the way react-toastify builds one.
 *
 * The shape is theirs and it is worth copying because every part of it is doing
 * something: an icon that says what *kind* of message this is before the words
 * are read, a body that takes the rest of the width, a close button pinned to
 * the top corner rather than centred against a message that may be two lines,
 * and — the part that carries the most and is easiest to leave out — a
 * **progress bar along the bottom edge** that says how long is left.
 *
 * **The bar is the timer.** Not a picture of one. It is a CSS animation from
 * `scaleX(1)` to `scaleX(0)` over the toast's own lifetime, and its `animationend`
 * is what dismisses the notice — so pausing it pauses the countdown, and there
 * is no second clock in JavaScript that could disagree with what is on screen.
 * That is react-toastify's trick and it is the reason their pause-on-hover is
 * exact where a `setTimeout` version drifts by however long the paint took.
 *
 * It pauses for three reasons: the pointer is on it, the pile it is in has been
 * opened to be read, or the window has lost focus. The last one is theirs too
 * (`pauseOnFocusLoss`) and it is the one nobody thinks of: a message raised
 * while you were in another application should still be there when you come
 * back to it.
 *
 * **It can be thrown away.** Dragging horizontally moves it one to one with the
 * pointer and fades it as it goes; past 80% of its own width — react-toastify's
 * `draggablePercent` — releasing it dismisses it, and anything short of that
 * springs back. A close button is a small target reached by aiming; a swipe is
 * a gesture, and for something you are dismissing rather than reading it is the
 * better of the two.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Toast } from '../../stores/toasts';
import { useDrag } from '../../composables/useDrag';
import AppIcon from '../ui/AppIcon.vue';

const props = defineProps<{
  notice: Toast;
  /** Something other than the pointer is holding the countdown: see the note. */
  held?: boolean;
}>();
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

/* ---------------------------------------------------------------- countdown */

const root = ref<HTMLElement>();
const hovered = ref(false);

/**
 * Whether the window is the one being looked at.
 *
 * `pauseOnFocusLoss`, and the reason it matters here more than on a web page:
 * this app raises notices from work that runs in the background, so the common
 * case for "an export finished" is that nobody was looking when it did.
 */
const blurred = ref(typeof document !== 'undefined' && document.visibilityState === 'hidden');

function onWindowBlur(): void {
  blurred.value = true;
}
function onWindowFocus(): void {
  blurred.value = false;
}

onMounted(() => {
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('focus', onWindowFocus);
});

onBeforeUnmount(() => {
  window.removeEventListener('blur', onWindowBlur);
  window.removeEventListener('focus', onWindowFocus);
});

const paused = computed(() => hovered.value || props.held === true || blurred.value);

/** A notice with no expiry waits; it gets no bar, because there is nothing to show. */
const counts = computed(() => (props.notice.expire ?? 0) > 0);

/* -------------------------------------------------------------------- swipe */

/** How far across its own width a notice has to be thrown to go. Theirs is 80%. */
const THROW = 0.8;

const offset = ref(0);
const thrown = ref(false);

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
    if (Math.abs(state.value) < width * THROW) {
      // Short of the threshold: back where it was, on the same curve
      // everything else in this app returns on.
      offset.value = 0;
      return;
    }

    /*
     * Sent the way it was going, and dismissed when it gets there. The element
     * has to leave the screen before it leaves the DOM, or the ones below it
     * close the gap while this one is still visibly mid-flight.
     */
    thrown.value = true;
    offset.value = Math.sign(state.value) * width * 2;
  },
});

function onGrab(event: PointerEvent): void {
  // Not from the close button or the action: those are targets, and a press on
  // a target that also starts a drag is a target that misfires when the hand
  // moves two pixels.
  if ((event.target as HTMLElement).closest('button')) return;
  start(event);
}

function onSettled(): void {
  if (thrown.value) emit('dismiss');
}

// A notice replaced in place — same id, new message — starts its life again.
watch(
  () => props.notice.message,
  () => {
    offset.value = 0;
    thrown.value = false;
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
    class="notice"
    :class="[
      `notice--${notice.tone}`,
      { 'notice--dragging': dragging, 'notice--paused': paused },
    ]"
    :style="{
      '--offset': `${offset}px`,
      '--fade': String(1 - fade),
      '--life': `${notice.expire ?? 0}ms`,
    }"
    :role="live"
    @pointerdown="onGrab"
    @pointerenter="hovered = true"
    @pointerleave="hovered = false"
    @focusin="hovered = true"
    @focusout="hovered = false"
    @transitionend.self="onSettled"
  >
    <!--
      Icon, body, close — react-toastify's three parts, in their order. The
      close button is aligned to the top rather than centred, so it stays where
      the eye expects it whether the message is one line or three.
    -->
    <span class="notice__icon" aria-hidden="true">
      <AppIcon :name="ICON[notice.tone]" :size="15" />
    </span>

    <div class="notice__body">
      <p v-if="notice.title" class="notice__title">
        {{ notice.title }}
      </p>
      <p class="notice__message">
        {{ notice.message }}
      </p>

      <button v-if="notice.action" type="button" class="notice__action focus-fill" @click="act">
        {{ notice.action.label }}
      </button>
    </div>

    <button
      type="button"
      class="notice__close focus-fill"
      :aria-label="$t('action.close')"
      @click="emit('dismiss')"
    >
      <AppIcon name="close" :size="11" />
    </button>

    <!--
      The bar *is* the timer: when it finishes, the notice goes. Hidden from
      assistive technology because "a bar shrinking" is not information anybody
      needs read out — the notice is already announced by its live region.
    -->
    <span
      v-if="counts"
      class="notice__progress"
      aria-hidden="true"
      @animationend="emit('dismiss')"
    />
  </div>
</template>

<style scoped>
/*
 * One colour per notice, named once and used four times.
 *
 * react-toastify hardcodes `#07bc0c` and friends; this reads the theme's own
 * semantic colours instead, because a fixed green cannot answer both
 * appearances, `prefers-contrast`, or the contrast tests this app runs.
 * Everything else about the anatomy is theirs.
 */
.notice {
  --tone: var(--color-primary);
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--gap);
  inline-size: 100%;
  min-block-size: 3.25rem;
  padding: var(--gap-loose) var(--gap-tight) var(--gap-loose) calc(var(--gap-loose) + 4px);
  border: 1px solid color-mix(in oklab, var(--tone) 34%, transparent);
  border-radius: var(--radius-box);
  /*
   * A wash rather than a slab. Twelve per cent of the tone over the popover's
   * own colour is enough to tell four notices apart at a glance and little
   * enough that the message is still text on a surface.
   */
  background-color: color-mix(in oklab, var(--tone) 12%, var(--color-base-100));
  overflow: hidden;
  cursor: default;
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
 * The tone at full strength, on the one edge that can carry it.
 *
 * A four-pixel bar is the cue that survives peripheral vision, which is what a
 * notice in the corner of a window has to work in.
 */
.notice::before {
  content: '';
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  inline-size: 4px;
  background: var(--tone);
}

.notice__icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  inline-size: 1.25rem;
  block-size: 1.25rem;
  color: var(--tone);
}

.notice--success {
  --tone: var(--color-success);
}

.notice--warning {
  --tone: var(--color-warning);
}

.notice--error {
  --tone: var(--color-error);
}

.notice__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--gap-tight);
  min-width: 0;
  padding-block: 0.1rem;
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
  color: color-mix(in oklab, var(--color-base-content) 88%, transparent);
}

.notice__action {
  align-self: flex-start;
  height: var(--field-h);
  padding-inline: var(--gap);
  margin-inline-start: calc(var(--gap) * -1);
  border-radius: var(--control-radius);
  font-size: 0.75rem;
  font-weight: 550;
  color: var(--color-primary-text, var(--color-primary));
}

/* Top-aligned, so it does not wander down the card as the message wraps. */
.notice__close {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  align-self: flex-start;
  width: var(--hit-min);
  height: var(--hit-min);
  margin-block-start: -0.15rem;
  border-radius: var(--control-radius);
  color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
  opacity: 0.7;
  transition: opacity var(--t-hover) var(--ease-out);
}

/*
 * The countdown, drawn.
 *
 * `transform-origin: left` and a linear timing function, exactly as
 * react-toastify draws it: the bar has to empty at a constant rate or it
 * misreports the time left, and it has to shrink from the leading edge or it
 * reads as something arriving rather than something running out.
 */
.notice__progress {
  position: absolute;
  inset-block-end: 0;
  inset-inline: 0;
  block-size: 3px;
  transform-origin: left;
  background: var(--tone);
  opacity: 0.65;
  animation: notice-life var(--life) linear forwards;
}

/* Bound from `paused`, not from `:hover`, because two of the three reasons a
   countdown stops are not the pointer: the pile is open, or the window is not
   the one being looked at. */
.notice--paused .notice__progress,
.notice--dragging .notice__progress {
  animation-play-state: paused;
}

@keyframes notice-life {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}

@media (hover: hover) and (pointer: fine) {
  .notice__action:hover,
  .notice__close:hover {
    background: var(--fill-4);
  }

  .notice__close:hover {
    color: var(--color-base-content);
    opacity: 1;
  }
}

/*
 * Reduced motion keeps the countdown and drops the sliding.
 *
 * The bar is information rather than decoration — it is the only thing saying
 * how long is left — so it stays, and only the movement goes.
 */
@media (prefers-reduced-motion: reduce) {
  .notice:not(.notice--dragging) {
    transition-duration: 1ms;
  }
}
</style>
