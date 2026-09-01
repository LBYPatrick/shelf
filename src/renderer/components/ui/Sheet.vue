<script setup lang="ts">
/**
 * A modal sheet.
 *
 * It arrives as a material rather than a fade: the blur and the scale animate
 * together, so it reads as a surface coming forward rather than a rectangle
 * appearing. The scrim dims what is behind it, because a modal task wants the
 * rest of the window pushed back rather than merely covered.
 *
 * Focus is trapped while it is open and returned to whatever had it before,
 * which is what keeps it usable without a mouse.
 */
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { useDismiss } from '../../composables/useDismiss';
import AppIcon from './AppIcon.vue';

const props = defineProps<{
  title: string;
  subtitle?: string;
  /** A glyph before the name, for a sheet that is a place rather than a task. */
  icon?: string;
  /**
   * Keeps the name out of the chrome without taking it away.
   *
   * For a sheet whose content *is* its title — an announcement with one
   * sentence in it, set large and centred, where a heading in the corner
   * repeating the same idea is the second of two containers for one thing. The
   * title is still rendered and still the dialog's accessible name; it is only
   * not drawn, so nothing using a screen reader loses anything.
   *
   * Deliberately not "pass no title": a dialog with no accessible name is one
   * that announces itself as "dialog".
   */
  bareTitle?: boolean;
  /**
   * Draws over the other sheets rather than beside them.
   *
   * Every sheet sits on the same layer, so which of two open ones is in front
   * is decided by which is later in the document — and that is decided by which
   * *view* mounted last. A sheet the app owns, mounted above both views, is
   * therefore in front of the start screen's sheets and behind the workspace's:
   * the update panel opened from Settings was drawn underneath Settings, but
   * only once a database had been opened.
   *
   * So a sheet that can be opened over another one says so, rather than
   * inheriting an answer from mount order. Still below the command palette,
   * which is summoned deliberately and outranks everything.
   */
  overSheets?: boolean;
  wide?: boolean;
  /** Wider still, for a sheet holding a drawing rather than a form. */
  broad?: boolean;
  /**
   * The body takes the whole panel: no padding, and no fading edge.
   *
   * For a view that *is* the surface rather than sitting on one — an editor
   * filling the sheet. The fade exists to say that scrolling content passes
   * under the chrome, and over a bounded surface with its own footer it only
   * dims the last line of it.
   */
  flush?: boolean;
}>();
const open = defineModel<boolean>({ required: true });

const panel = ref<HTMLElement>();
/**
 * The dialog is named by its own heading rather than a duplicated aria-label,
 * so the accessible name and the visible title cannot drift apart.
 */
const titleId = useId();
let previouslyFocused: HTMLElement | null = null;

function focusables(): HTMLElement[] {
  if (!panel.value) return [];
  return [
    ...panel.value.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ),
  ];
}

/*
 * Escape goes through the shared stack rather than a listener of this sheet's
 * own. Every overlay had one, at the window and in the capture phase, and they
 * all fired: a sheet opened from a sheet closed both at once.
 */
useDismiss(open);

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;

  const items = focusables();
  if (items.length === 0) return;

  const first = items[0]!;
  const last = items[items.length - 1]!;
  const current = document.activeElement;

  // Wrap at both ends so Tab never escapes the sheet into the page behind it.
  if (event.shiftKey && current === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && current === last) {
    event.preventDefault();
    first.focus();
  }
}

watch(open, async (isOpen) => {
  if (isOpen) {
    previouslyFocused = document.activeElement as HTMLElement | null;
    await nextTick();
    focusables()[0]?.focus();
  } else {
    previouslyFocused?.focus();
    previouslyFocused = null;
  }
});

/**
 * Withholds the body's scroll-driven edge for one frame after mounting.
 *
 * A sheet that is *mounted already open* inserted an element carrying an
 * `animation-timeline: scroll()` into the document in the same commit that made
 * it visible, and Chromium crashed the renderer outright — not an exception,
 * the whole window gone. Shift-clicking a grid cell did exactly that, because
 * the value inspector was rendered with `v-if` on the value it was about to
 * show. The call site is fixed too, but a sheet must not be the kind of
 * component that has a rule about how it may be mounted.
 */
const edges = ref(false);
onMounted(() => requestAnimationFrame(() => (edges.value = true)));

/* ------------------------------------------------------------------- height */

/**
 * As tall as it needs to be, and no taller.
 *
 * Every sheet used to take one fixed height, on the argument that a sheet whose
 * content arrives late would otherwise resize under the reader. That solved the
 * flicker by paying for it everywhere: a popup with six facts in it reserved
 * the room for forty and left two thirds of itself empty, and it was the same
 * empty whatever was in it.
 *
 * So it follows its content, and the objection is answered directly instead:
 * the change is *animated*, on a curve that decelerates, and the sheet stays
 * centred while it happens — so a late answer reads as the window settling
 * rather than as the ground moving. Past four fifths of the viewport it stops
 * growing and the body scrolls, which is the only point at which a fixed height
 * was ever the right answer.
 */
const measure = ref<HTMLElement>();
const head = ref<HTMLElement>();
const foot = ref<HTMLElement>();

/** The share of the window a sheet may take before it starts scrolling. */
const CEILING = 0.8;

/**
 * ...or this many pixels, whichever is more.
 *
 * A share alone is the wrong shape on a small window. The start screen is a
 * compact window by design, and four fifths of it left a hundred and sixteen
 * pixels of scrim doing nothing while the form inside it scrolled. A fraction
 * says how much of a *large* window a popup may take; on a small one what
 * matters is that it is big enough to hold a form, and the scrim's own margin
 * is the real limit.
 */
const FLOOR = 480;

/** What the scrim keeps for itself, top and bottom, as a share of the window. */
const SCRIM = 0.04;

const height = ref<number | null>(null);
const overflowing = ref(false);
let sizer: ResizeObserver | undefined;
let queued = 0;

/**
 * How many frames a measurement is allowed to keep changing for.
 *
 * Four, because the content here settles in three steps and the fourth is what
 * proves it has stopped. It is a ceiling on a loop that normally runs twice,
 * not a duration anybody waits out.
 */
const SETTLE_FRAMES = 4;

/**
 * Measures until the answer stops moving, a frame at a time.
 *
 * A `ResizeObserver` that measures and writes a height is a loop by
 * construction: the write resizes the panel, the panel resizes the content's
 * box, and the observer is due again. Chromium protects itself by *stopping
 * delivery* partway through — and which notification it drops depends on how
 * the frame went, so this sheet settled at the right height on one run and
 * thirteen pixels short on the next.
 *
 * Instrumented, the wrapper here grew in three steps — 392, then 410 when the
 * measured sizes arrived, then 422 when the last of it reflowed — and the
 * observer reported the first two and never the third. The panel kept the
 * second answer, and the only thing that corrected it was the fallback below
 * firing on some unrelated transition: hovering the footer button was enough,
 * which is how this was found.
 *
 * So the observer stops being the thing that has to be right. It starts a short
 * loop that re-measures each frame and stops as soon as two measurements agree
 * — which is the same question the observer was being asked, put to the layout
 * directly rather than to a notification queue that is allowed to drop it.
 */
/**
 * And how many it may keep *correcting* for.
 *
 * Agreeing with the last answer is not the same as being right. A measurement
 * taken while the content was still arriving agrees with itself perfectly, and
 * the sheet then sits at a height that clips what it holds — with `overflowing`
 * false, so no scrollbar to reach it with and no fade to admit it is there.
 *
 * Everything that used to correct that is something outside this loop: an
 * observer notification Chromium is allowed to drop, or `onSettled` firing at
 * the end of the height transition. Neither is dependable. The transition is
 * the worse of the two — `prefers-reduced-motion` takes `height` out of
 * `transition-property` entirely, so for a reader who has asked for less motion
 * the fallback never fires at all, and the sheet stays short for good.
 *
 * So the loop asks the layout instead: while the body is showing less than it
 * holds, it has not settled, whatever two consecutive measurements agree about.
 * A second of frames is far more than the three steps this takes and is a
 * ceiling rather than a duration — it exits as soon as the answer is consistent,
 * which is normally the second frame.
 */
const CORRECT_FRAMES = 60;

/**
 * Content the body is neither showing nor scrolling for.
 *
 * A pixel is rounding, not a clip: `natural` is computed with a `Math.ceil` and
 * a spare pixel already, so chasing one would be chasing our own arithmetic.
 */
function clipped(): boolean {
  const body = measure.value?.parentElement;
  if (!body || overflowing.value) return false;
  return body.scrollHeight - body.clientHeight > 1;
}

function measureSoon(): void {
  let left = SETTLE_FRAMES;
  let budget = CORRECT_FRAMES;

  const pump = (): void => {
    queued = requestAnimationFrame(() => {
      if (--budget <= 0) return;

      const before = height.value;
      resize();

      // Still moving: let it, for as long as it keeps moving.
      if (height.value !== before) {
        if (--left > 0) pump();
        return;
      }

      // Stopped, but on a height that hides content. That is the stale
      // measurement rather than a settled one, so it is still moving really.
      if (clipped()) {
        left = SETTLE_FRAMES;
        pump();
      }
    });
  };

  cancelAnimationFrame(queued);
  pump();
}

function resize(): void {
  const body = measure.value?.parentElement;
  if (!body) return;

  /*
   * Measured off the wrapper, and never off the panel or the body.
   *
   * Both of those are the boxes being *constrained*, so their height is the
   * answer we are trying to compute, and `scrollHeight` on either is never
   * smaller than the box it is read from — a panel already holding a height
   * reports that height as its content's, so every sheet could grow and none
   * could shrink. Switching settings from its long list of sections to its
   * short editor left the editor above a third of a window of nothing.
   *
   * Taking the constraint off to measure and putting it straight back is worse
   * than the bug: reading a layout property flushes style, so the browser takes
   * the *natural* height as the one the transition starts from, and the sheet
   * jumps to its new size with a 280ms animation from that size to itself. It
   * looked like the animation had been removed.
   *
   * The wrapper is under no such constraint — it is a plain block that is
   * exactly as tall as what is in it, whatever the body around it has been told
   * to be. It is a `flow-root` so that a first or last child's margin is inside
   * that measurement rather than collapsing out through it; adding up the
   * pieces without that came out a pixel or two short, and a popup whose
   * content fitted drew a scrollbar down the side of a panel with room to
   * spare.
   */
  const box = getComputedStyle(body);
  const padding = parseFloat(box.paddingTop) + parseFloat(box.paddingBottom);
  const chrome = (head.value?.offsetHeight ?? 0) + (foot.value?.offsetHeight ?? 0);
  let natural = chrome + Math.ceil(measure.value!.getBoundingClientRect().height + padding) + 1;

  /*
   * And never shorter than what the body says it is holding.
   *
   * The wrapper is the right thing to measure — everything above says why — but
   * it is measured in fractional pixels and `scrollHeight` is a rounded
   * integer, and the two disagree by a pixel or two depending on where the text
   * landed. The spare pixel added above covers that in one direction and not in
   * the other, so on a machine whose rasteriser rounds the other way a sheet
   * settles two pixels short of its content: a clipped last line, `overflowing`
   * false, and so no scrollbar to reach it with. Small enough to look like
   * nothing and to survive three rounds of chasing it.
   *
   * So the browser's own account of what it cannot show is taken as a floor.
   * It converges rather than oscillating: growing by the shortfall makes the
   * shortfall zero, and height does not change what the text wraps to.
   */
  const shortfall = body.scrollHeight - body.clientHeight;
  if (shortfall > 0 && height.value !== null && !overflowing.value) {
    natural = Math.max(natural, height.value + shortfall);
  }

  const view = window.innerHeight;
  const ceiling = Math.min(view * (1 - SCRIM * 2), Math.max(view * CEILING, FLOOR));

  /*
   * Whether the body scrolls is decided here, not left to `overflow: auto`.
   *
   * A classic scrollbar takes its width out of the content, so a body that
   * scrolls by a few pixels narrows its own text, wraps a line, and grows —
   * which is more overflow. Measuring, growing the panel, losing the scrollbar,
   * and measuring again is a loop the browser settles by stopping partway, and
   * where it stopped was a popup seven pixels short of its content with a track
   * down the side of it. Since the measurement already knows whether the
   * content fits, the sheet says so: at its natural size nothing scrolls, so
   * nothing can appear to change the width it was measured at.
   */
  /*
   * And a few pixels of slack, because the decision is a coin flip without it.
   *
   * A panel whose content lands within a pixel or two of the ceiling flips
   * between scrolling and not on nothing more than how the text rasterised
   * that run — and flipping means a scrollbar appearing, taking its width out
   * of the content, and rewrapping a line. The settings sheet sat exactly
   * there, and photographed differently on consecutive runs of the same build.
   *
   * Four pixels over an eighty-per-cent-of-the-viewport cap is invisible; a
   * scrollbar that comes and goes is not. So a panel that nearly fits is
   * allowed to be slightly taller than the nominal ceiling and keep its width.
   */
  const SLACK = 4;

  overflowing.value = natural > ceiling + SLACK;
  height.value = overflowing.value ? Math.round(ceiling) : natural;
}

/*
 * Observed rather than watched: what changes the height is content arriving,
 * a disclosure opening, a translation being longer — none of which any one
 * caller could be relied upon to announce.
 */
watch([open, measure], async ([isOpen]) => {
  sizer?.disconnect();
  sizer = undefined;
  cancelAnimationFrame(queued);

  if (!isOpen) {
    height.value = null;
    return;
  }

  await nextTick();
  resize();

  if (measure.value) {
    sizer = new ResizeObserver(measureSoon);
    sizer.observe(measure.value);
  }
});

/*
 * And once more when anything in the sheet has finished moving.
 *
 * The observer alone is not enough when the *content* animates: measuring it
 * resizes the panel, resizing the panel resizes the content's box, and
 * Chromium's loop protection cuts the round trip off partway through — which
 * left a properties popup seven pixels short of a list that had grown while it
 * was opening. Transitions and animations bubble, so the end of the last one is
 * the moment to ask again — including the sheet's own height transition, which
 * ends 280ms after the last change and so is late enough for anything still
 * settling underneath. It cannot run away: a measurement that agrees with the
 * height already applied changes nothing, and so starts no transition to end.
 */
function onSettled(): void {
  resize();
}

function onWindowResize(): void {
  if (open.value) resize();
}

onMounted(() => window.addEventListener('resize', onWindowResize));

onBeforeUnmount(() => {
  sizer?.disconnect();
  cancelAnimationFrame(queued);
  window.removeEventListener('resize', onWindowResize);
});

onBeforeUnmount(() => previouslyFocused?.focus());

void props;
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div
        v-if="open"
        class="scrim"
        :class="{ 'scrim--over': overSheets }"
        @keydown="onKeydown"
        @click.self="open = false"
      >
        <div
          ref="panel"
          class="panel surface-sheet mat-edge-top"
          :class="{ 'panel--wide': wide, 'panel--broad': broad }"
          :style="height !== null ? { height: `${height}px` } : undefined"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          @transitionend="onSettled"
          @animationend="onSettled"
        >
          <header ref="head" class="panel__head">
            <AppIcon v-if="icon" class="panel__icon" :name="icon" :size="17" />

            <!--
              A stacked label: what this thing belongs to, then what it is. The
              subtitle goes *above* rather than below because it is the wider
              context — you read inward, and a title followed by something
              broader reads as an afterthought.
            -->
            <div class="panel__titles" :class="{ 'sr-only': bareTitle }">
              <p v-if="subtitle" class="panel__eyebrow">
                {{ subtitle }}
              </p>
              <h2 :id="titleId" class="type-title">
                {{ title }}
              </h2>
            </div>

            <!--
              Controls that switch what the sheet is showing belong on the same
              row as its name, not on one of their own. A row containing a
              single switcher is a row of chrome, and the sheet has only so many
              of them before the content starts below the fold.

              Two places for them, because they are two different kinds of
              thing. What the sheet is *showing* belongs beside its name, where
              a subtitle would go — it qualifies the title. What the sheet can
              *do* belongs at the far end, beside the close button, with the
              other verbs.
            -->
            <div v-if="$slots.lead" class="panel__lead">
              <slot name="lead" />
            </div>

            <div v-if="$slots.header" class="panel__tools">
              <slot name="header" />
            </div>

            <button
              type="button"
              class="panel__close"
              :aria-label="$t('action.close')"
              @click="open = false"
            >
              ✕
            </button>
          </header>

          <div
            class="panel__body"
            :class="{
              'panel__body--edges': edges && !flush,
              'panel__body--flush': flush,
              'panel__body--scrolls': overflowing,
            }"
          >
            <!--
              A wrapper with no styling of its own, whose only job is to be
              exactly as tall as the content. The body cannot be measured for
              this: it is the element being constrained, so its height is the
              answer we are trying to compute.
            -->
            <div ref="measure" class="panel__measure">
              <slot />
            </div>
          </div>

          <footer v-if="$slots.footer" ref="foot" class="panel__foot">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  /*
   * Centred, so a sheet that grows or shrinks expands about its middle rather
   * than dropping its foot. Top-aligned, every resize moved the bottom edge
   * only — which reads as the content pushing the window down instead of the
   * window taking the room it needs.
   */
  place-items: center;
  padding-block: 4vh;
}

/*
 * One step over the other sheets, and one step under the command palette at
 * 120 — see the note on `overSheets`. A whole layer apart would put it over the
 * menus at 200 and the hover tips at 300 as well, which it has no business
 * being.
 */
.scrim--over {
  z-index: 110;
}

.panel {
  display: flex;
  flex-direction: column;
  width: min(34rem, calc(100vw - 4rem));
  /*
   * Four fifths of the window or 480px, whichever is more, and never more than
   * the scrim's own margin leaves. The height itself is set inline from the
   * measurement — see the note in the script — and this is the same ceiling
   * stated here as well, so a sheet still behaves before the first measurement
   * lands.
   */
  max-height: min(92vh, max(80vh, 480px));
  border-radius: 1.25rem;
  overflow: hidden;
  /*
   * The curve decelerates: fast at the start, settling at the end, which is
   * what makes a size change read as the window arriving at a size rather than
   * being dragged to one. Linear here would look mechanical at exactly the
   * moment the reader is deciding whether the interface is responding to them.
   */
  transition: height var(--t-panel) var(--ease-sheet);
}

.panel--wide {
  width: min(48rem, calc(100vw - 4rem));
}

/*
 * A form has a comfortable measure and stops there; a diagram is as wide as it
 * is, and every column of window it is denied is a column the reader has to pan
 * across instead.
 */
.panel--broad {
  width: min(72rem, calc(100vw - 3rem));
}

/* Contains its children's margins, so its height is the whole of what is in
   it — the number the sheet is sized from. */
.panel__measure {
  display: flow-root;
}

.panel__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gap);
  padding: var(--gap-loose) var(--gap-section);
}

.panel__titles {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.panel__eyebrow {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--text-soft);
}

.panel__titles .type-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Pushed to the trailing end, and never squeezed: the switcher is sized to its
   options, so a long title truncates before the controls do. */
.panel__icon {
  flex: 0 0 auto;
  color: var(--text-soft);
}

/* Beside the name and no further: it qualifies the title rather than acting. */
.panel__lead {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--gap);
}

.panel__tools {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--gap);
  margin-inline-start: auto;
}

.panel__lead ~ .panel__close {
  margin-inline-start: auto;
}

.panel__tools ~ .panel__close {
  margin-inline-start: 0;
}

.panel__close {
  display: grid;
  flex: 0 0 auto;
  margin-inline-start: auto;
  place-items: center;
  width: var(--hit-min);
  height: var(--hit-min);
  border-radius: 999px;
  font-size: 0.75rem;
  color: var(--text-soft);
}

.panel__close:hover {
  background: var(--fill-3);
  color: var(--color-base-content);
}

/*
 * A scroll edge, not a hard cut — and only where something is actually cut off.
 *
 * A sheet taller than the window used to guillotine its content against the
 * footer — the Settings pane ended mid-control with nothing to say there was
 * more. The mask fades the last few millimetres out where the content passes
 * under the chrome, which reads as "this continues" without spending a divider
 * on it.
 *
 * **Both edges are conditional, and the bottom one was not.** The top faded in
 * only once you had scrolled, as it should; the bottom was a constant, so every
 * sheet that fitted perfectly well dimmed its own last row for no reason — on
 * the stored-data sheet that row is the button that does the thing, and it
 * looked like it had been disabled. The two edges now answer the same question
 * from the two ends of the same scroll: is there anything above, is there
 * anything below. Nothing above or below means no mask at all, which is the
 * case almost every sheet in this app is in.
 */
.panel__body {
  flex: 1;
  min-height: 0;
  /* Scrolls only when the measurement says it must — see the note in resize(). */
  overflow-y: hidden;
  padding: 0 var(--gap-section) var(--gap-section);
  mask-image: linear-gradient(
    to bottom,
    transparent 0,
    #000 var(--sheet-edge-top, 0px),
    #000 calc(100% - var(--sheet-edge-bottom, 0px)),
    transparent 100%
  );
}

.panel__body--scrolls {
  overflow-y: auto;
  /*
   * The static answer, for an engine with no scroll timeline: content that
   * overflows keeps its bottom edge whatever the scroll position. Overridden
   * below where the timeline exists, which is every build this ships in — it is
   * here so the rule does not depend on a feature to be *safe*, only to be
   * exact.
   */
  --sheet-edge-bottom: 1.25rem;
}

@supports (animation-timeline: scroll()) {
  .panel__body--edges {
    animation:
      sheet-edge-top linear both,
      sheet-edge-bottom linear both;
    animation-timeline: scroll(self block), scroll(self block);
    /* The first over the opening centimetre of the scroll, the second over the
       closing one — so each edge is present exactly while there is something
       past it. A body that does not scroll has no timeline, and both hold at
       their fallback of nothing. */
    animation-range:
      0 1.25rem,
      calc(100% - 1.25rem) 100%;
  }

  @keyframes sheet-edge-top {
    from {
      --sheet-edge-top: 0px;
    }
    to {
      --sheet-edge-top: 1.25rem;
    }
  }

  @keyframes sheet-edge-bottom {
    from {
      --sheet-edge-bottom: 1.25rem;
    }
    to {
      --sheet-edge-bottom: 0px;
    }
  }
}

.panel__body--flush {
  padding: 0;
  mask-image: none;
}

/*
 * `align-items: center`, because the row holds two kinds of thing.
 *
 * Without it a bare `<span>` of hint text stretches to the row's height and
 * renders its text at the top of that box, while the buttons beside it sit at
 * their own height — so the sentence rode visibly high against them. Every
 * footer in the app has that shape, and none of them wants it.
 */
.panel__foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--gap);
  padding: var(--gap-loose) var(--gap-section);
  border-top: 1px solid var(--separator);
}

/*
 * The material arrives: blur and scale move together so it reads as a surface
 * coming forward, not a rectangle fading up.
 */
.sheet-enter-active .panel,
.sheet-leave-active .panel {
  transition:
    transform var(--t-sheet) var(--ease-sheet),
    opacity var(--t-pop) var(--ease-out);
}

.sheet-enter-active,
.sheet-leave-active {
  transition: opacity var(--t-pop) var(--ease-out);
}

.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}

.sheet-enter-from .panel,
.sheet-leave-to .panel {
  transform: translateY(-12px) scale(0.97);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .sheet-enter-from .panel,
  .sheet-leave-to .panel {
    transform: none;
  }

  /* The size still changes; it simply stops being a movement to watch. */
  .panel {
    transition: none;
  }
}
</style>
