<script setup lang="ts">
/**
 * A newer build, and what to do about it.
 *
 * One sheet for the whole flow rather than one per state, because it is one
 * conversation: is there a new version, do you want it, here it comes, restart
 * when you like. Four panels would make the reader lose their place three
 * times, and the sheet already animates its own height — so the content
 * changes and the window settles around it.
 *
 * **The verb at the end depends on what this install can do, and nothing else
 * does.** Where the app can replace itself the button downloads and then
 * restarts; where it cannot — a .deb the package manager owns, a portable .exe,
 * a build being developed — the same panel says the same thing and offers the
 * page instead. Nobody is shown a Restart that was never going to work, and
 * nobody is left without an answer because of how they installed the app.
 *
 * **Nothing here starts on its own.** The check reports; the download is a
 * press; the restart is a press. An app that quits itself to install something
 * is an app that ate an unsaved query.
 */
import { computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { formatBytes } from '@shared/bytes';
import { useUpdates } from '../../stores/updates';
import AppIcon from '../ui/AppIcon.vue';
import MarkdownText from '../assistant/MarkdownText.vue';
import PressButton from '../ui/PressButton.vue';
import ProgressBar from '../ui/ProgressBar.vue';
import Sheet from '../ui/Sheet.vue';

const updates = useUpdates();
const { t } = useTranslation();

const open = computed({
  get: () => updates.open,
  // Closing by any route — the ✕, the scrim, Escape — is the same decision as
  // pressing Later, so it goes through the same door and main hears about it.
  set: (value: boolean) => {
    if (!value) updates.dismiss();
  },
});

const state = computed(() => updates.state);

/** The share downloaded, or nothing at all before the first byte lands. */
const fraction = computed(() => {
  const progress = state.value.progress;
  if (!progress || progress.total <= 0) return undefined;
  return progress.transferred / progress.total;
});

const transferred = computed(() => {
  const progress = state.value.progress;
  if (!progress) return '';
  return t('update.transferred', {
    done: formatBytes(progress.transferred),
    total: formatBytes(progress.total),
  });
});

/**
 * The heading, which is the one line somebody reads before deciding.
 *
 * It names the version rather than the event: "Shelf 1.4.0 is available" tells
 * a reader what they are being offered, where "An update is available" makes
 * them open the notes to find out.
 */
const heading = computed(() => {
  switch (state.value.phase) {
    case 'checking':
      return t('update.checking');
    // No version in this one: the line under it already carries the number, and
    // a heading that repeated it is what made that line conditional.
    case 'current':
      return t('update.current');
    case 'available':
      return t('update.available', { version: state.value.release?.version ?? '' });
    case 'downloading':
      return t('update.downloading', { version: state.value.release?.version ?? '' });
    case 'ready':
      return t('update.ready', { version: state.value.release?.version ?? '' });
    case 'error':
      return t('update.failed');
    default:
      return t('update.title');
  }
});

function primary(): void {
  if (state.value.phase === 'ready') {
    updates.install();
    return;
  }
  if (state.value.phase === 'available') {
    if (updates.canInstall) void updates.download();
    else void updates.openPage();
    return;
  }
  void updates.check();
}

/**
 * What the one button says it will do.
 *
 * No case for `checking` or `downloading`: the button is not drawn while either
 * is running, because the bar underneath is already saying so and a disabled
 * button beside a moving bar adds nothing. The default covers the three states
 * where the only thing left to do is ask again — idle, up to date, and failed.
 */
const primaryLabel = computed(() => {
  switch (state.value.phase) {
    case 'ready':
      return t('update.restart');
    case 'available':
      return updates.canInstall ? t('update.download') : t('update.openPage');
    default:
      return t('update.checkNow');
  }
});

const primaryIcon = computed(() => {
  switch (state.value.phase) {
    case 'ready':
      return 'refresh';
    case 'available':
      return updates.canInstall ? 'download' : 'view';
    default:
      return 'refresh';
  }
});
</script>

<template>
  <!--
    Nothing in the chrome but the way out.
    ──────────────────────────────────────
    No icon: `Sheet`'s is for a sheet that is a *place*, and this is a task —
    it already has a mark of its own below, the tinted disc that carries the
    verdict. No eyebrow: it said "Shelf" one line above a sentence that says
    "Shelf 1.3.1". And no drawn title, because the sentence in the middle of
    the panel *is* the title — "Shelf 1.3.1 is the latest version." — so a
    heading in the corner saying "Software update" was the second of two
    containers for one idea.

    All three were also an alignment problem. The chrome's 17px icon and the
    body's 32px disc started at the same padding edge, so their headings landed
    fifteen pixels apart, one directly above the other. With the chrome empty
    the sheet's own content edge is the only left edge on the panel.

    `bare-title` rather than an empty title: the name is still rendered and
    still what names the dialog, it is simply not drawn. A dialog with no
    accessible name announces itself as "dialog".

    `over-sheets` because this panel is the app's rather than a view's, and it
    opens over whatever is already up — Settings, most obviously, since that is
    where the button is. Without it the layer is decided by document order,
    which is decided by which view mounted last: on the start screen this drew
    in front of Settings and in the workspace it drew behind it.
  -->
  <Sheet v-model="open" :title="$t('update.title')" bare-title over-sheets>
    <!--
      The wrapper is the live region, not the heading inside it.
      ─────────────────────────────────────────────────────────
      The heading is replaced on every phase change, and a live region that is
      itself replaced announces nothing — the announcement has to come from an
      element that stays. Polite, because none of this interrupts anything: the
      reader opened this panel and is looking at it.
    -->
    <div class="update" aria-live="polite">
      <div class="phase">
        <!--
          The heading swaps, and nothing else does.
          ────────────────────────────────────────
          This wrapped the whole block once, keyed on the phase, and that made
          the release notes — the largest thing here and the one thing identical
          across available, downloading and ready — fade out and back in every
          time the phase moved. Motion on the part that did not change.

          So the transition is around the header alone: the line that says what
          is happening and the disc whose colour agrees with it. `out-in`,
          because two headings dissolving through each other is two objects
          where this is one object saying something new — and the cost of
          serialising them is paid by making the leave the faster half.
        -->
        <Transition name="phase" mode="out-in">
          <header :key="state.phase" class="head">
            <span class="head__mark" :class="`head__mark--${state.phase}`">
              <AppIcon
                :name="
                  state.phase === 'error'
                    ? 'warning'
                    : state.phase === 'current'
                      ? 'check'
                      : 'download'
                "
                :size="18"
              />
            </span>

            <div class="head__lines">
              <h3 class="head__title">{{ heading }}</h3>
              <!--
                Always. It used to be hidden in the up-to-date state, because
                "Shelf 1.3.1 is the latest version." above "You have 1.3.1."
                was the same fact twice — but a line that comes and goes is a
                panel that changes height every time somebody presses the
                button, so the repetition is answered in the *sentence*
                instead: the heading no longer names the version, and this line
                does.
              -->
              <p class="head__note">
                {{ $t('update.installed', { version: state.current }) }}
              </p>
            </div>

            <!--
              The action, in the block it acts on.
              ───────────────────────────────────
              It was a footer rail with three controls in it, two of which were
              the same control: a Close beside a ✕ that already closes, and a
              Later that was the same Close under another name. What was left
              was one button — and a rail, a divider and a whole row of chrome
              to hold one button is a lot of window for it.

              So it sits under the sentence it follows from: "Shelf 1.4.0 is
              available." and then the thing you do about that. It is inside
              the header's transition on purpose, because its label is the same
              answer the heading is — available/Download, ready/Restart — and
              the two must never be seen disagreeing.

              Not while busy: a check or a download is already reporting itself
              on the bar below, and a disabled button beside a moving bar says
              nothing the bar has not said.
            -->
            <div class="act">
              <!--
                One slot, holding either the thing to do or the report that it
                is being done — never both, and never neither. It stays as tall
                as the button whatever is standing in it.

                Working, and how much of it is done. Indeterminate while the
                check is out — nothing knows how long a request takes — and
                determinate the moment there are bytes to count.
              -->
              <div class="slot">
                <div v-if="updates.busy" class="work">
                  <ProgressBar :value="state.phase === 'downloading' ? fraction : undefined" />
                  <p v-if="state.phase === 'downloading' && state.progress" class="work__count">
                    {{ transferred }}
                  </p>
                </div>

                <PressButton v-else size="sm" variant="primary" @click="primary">
                  <AppIcon :name="primaryIcon" :size="13" />
                  {{ primaryLabel }}
                </PressButton>
              </div>

              <!--
                The quieter of the two routes, for somebody on a metered
                connection who would rather fetch it themselves. Only where the
                app can install it: where it cannot, the page *is* the primary.

                Outside the slot, and shown for a release rather than for a
                phase — so it does not come and go as the download starts and
                finishes, which was the panel's other height change.
              -->
              <button
                v-if="state.release && updates.canInstall"
                type="button"
                class="pagelink focus-fill"
                @click="updates.openPage()"
              >
                {{ $t('update.openPage') }}
              </button>
            </div>
          </header>
        </Transition>

        <p v-if="state.phase === 'error'" class="message">
          {{ state.message }}
        </p>

        <!--
          The notes, as the release page wrote them, and outside the transition
          above on purpose: they are the same notes at every phase from the
          moment a release is found until the app restarts into it, so there is
          nothing here for a cross-fade to be about.

          Rendered through the same markdown component the assistant uses, which
          builds real elements rather than HTML — a release body is text from a
          server, and this app has exactly one rule about that.
        -->
        <section v-if="state.release?.notes" class="notes selectable">
          <h4 class="notes__title type-label">{{ $t('update.notes') }}</h4>
          <MarkdownText class="notes__body" :text="state.release.notes" />
        </section>

        <!--
          Said where the decision is, not in a footnote afterwards: on an
          install the app cannot replace, the page is the only route, and the
          reader should know that before they press anything.
        -->
        <p v-if="state.phase === 'available' && !updates.canInstall" class="hint">
          <AppIcon name="info" :size="13" />
          {{ $t('update.manualHint') }}
        </p>

        <p v-else-if="state.phase === 'ready'" class="hint">
          <AppIcon name="info" :size="13" />
          {{ $t('update.readyHint') }}
        </p>
      </div>
    </div>
  </Sheet>
</template>

<style scoped>
.update {
  display: flex;
  flex-direction: column;
}

.phase {
  display: flex;
  flex-direction: column;
  gap: var(--gap-loose);
}

/*
 * A centred column, not a row.
 *
 * As a row it had to agree with the sheet's own header about where text begins,
 * and it could not: the disc is twice the width of the chrome's glyph, so the
 * two headings sat fifteen pixels apart with nothing to explain the step. The
 * row also left the disc hanging ten pixels below a single line of text, which
 * is what made "you are up to date" read as an unfinished layout rather than as
 * a finished answer.
 *
 * Centred, there is no second left edge to disagree with — and it is the shape
 * this app already uses for the same kind of statement, in the About block at
 * the foot of Settings.
 */
.head {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--gap);
  padding-block-start: var(--gap-tight);
  text-align: center;
}

/*
 * A tinted disc rather than a bare glyph: it is the one thing in the panel read
 * from across the desk, and a 15px stroke on its own is not. The colour agrees
 * with the words beside it — a green tick over "the check failed" is the fault
 * this codebase has already fixed once, in the diagnosis sheet.
 */
.head__mark {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  /* Larger than it was as a row's leading glyph: it is the panel's own mark
     now, and the only one on it. */
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 999px;
  background: color-mix(in oklab, var(--color-primary) 14%, transparent);
  color: var(--color-primary-text);
  /*
   * Timed, because this is the part of the panel read first and from furthest
   * away: accent while it works, green when there is nothing to do, red when
   * the check failed. A step between those is a repaint; a transition is a
   * state change. `background-color` rather than the `background` shorthand,
   * which does not interpolate.
   */
  transition:
    background-color var(--t-pop) var(--ease-out),
    color var(--t-pop) var(--ease-out);
}

.head__mark--current {
  background: color-mix(in oklab, var(--color-success) 14%, transparent);
  color: var(--color-success);
}

.head__mark--error {
  background: color-mix(in oklab, var(--color-error) 14%, transparent);
  color: var(--color-error);
}

.head__lines {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

/* A step above body copy with the tracking pulled in, the way every other
   heading in this app grows. */
.head__title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 600;
  letter-spacing: -0.012em;
}

.head__note {
  margin: 0;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-soft);
}

.work {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
  width: 100%;
}

/* Centred, to agree with the block above it rather than with the bar's left
   end — the bar is full width and has no text edge of its own to line up on. */
.work__count {
  margin: 0;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  text-align: center;
  color: var(--text-soft);
}

/* Part of the verdict, so it is set with the verdict rather than against the
   left edge of the documents below it. */
.message {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.45;
  text-align: center;
  color: var(--color-error);
}

/*
 * The notes are a document inside a panel of chrome, so they get a surface of
 * their own and scroll inside it. The sheet's body is the scroller of last
 * resort — a release with forty lines of notes would otherwise carry the
 * heading and the buttons off the top and bottom of it.
 *
 * **And the cap has to know how much room there is, or both of them scroll.**
 * At 18rem flat the card kept its 288px whether the panel could afford it or
 * not, so on a short window the popup overflowed *as well* — measured at 77px
 * over on a 560px viewport and 45px over at 640 — and the reader got a
 * scrollbar inside a scrollbar.
 *
 * A share of the window, because that is the thing that varies. The floor it
 * has to survive is the smallest window this app will open: `COMPACT_SIZE` in
 * `main/window.ts` is 580px tall, where the sheet's own ceiling works out at
 * 480px and the tallest state that has notes — ready to install, which also
 * carries a hint — needs 270px for everything that is not the card. That
 * leaves 210px, or 36vh; 34vh is that with room for a heading to wrap in a
 * language whose words are longer.
 *
 * The 18rem is still there and still does the work on any ordinary window: it
 * is the smaller of the two from about 850px of height upwards, so nothing
 * changes on a screen anybody is really using. The share only bites where the
 * flat number could not fit.
 */
.notes {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
  max-height: min(18rem, 34vh);
  overflow-y: auto;
  padding: var(--gap-loose);
  border-radius: var(--control-radius);
  background: var(--surface-well);
}

.notes__title {
  margin: 0;
  color: var(--text-soft);
}

.notes__body {
  min-width: 0;
}

/*
 * Left-aligned, unlike the verdict above it, because it is prose.
 *
 * Centring it was tried and is wrong twice over: a sentence that wraps to two
 * lines centres as a block while its lines stay left-aligned inside it, so the
 * right edge frays — and the glyph, being a flex child, floats to the vertical
 * middle of the paragraph instead of marking its first line. It belongs with
 * the notes card it follows, which is also a document.
 */
.hint {
  display: flex;
  align-items: flex-start;
  gap: var(--gap-tight);
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--text-soft);
}

/* On the first line, not in the middle of the paragraph. The nudge is optical:
   the glyph's box is taller than the cap height it sits beside. */
.hint > :first-child {
  margin-block-start: 0.15rem;
}

/*
 * The action, and the quieter route under it.
 *
 * A little further from the sentence above than the sentence is from the disc,
 * so the block reads as a statement and then a thing to do about it rather than
 * as three lines of equal weight.
 */
.act {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--gap-tight);
  width: 100%;
  margin-block-start: var(--gap-tight);
}

/*
 * As tall as the button, whatever is standing in it.
 *
 * The button and the progress bar are one moment seen from two sides — press
 * it and it becomes the bar, the bar finishes and it becomes the button again
 * — so they share one box rather than taking turns at two different heights.
 * Without this the panel measured 187px, then 181px while the check was out,
 * then 187px again: a six-pixel shrink and grow, animated over a quarter of a
 * second, every time anybody pressed it.
 */
.slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--gap-tight);
  width: 100%;
  min-height: var(--hit-min);
}

/* The second route, quiet under the first. */
.pagelink {
  border-radius: var(--control-radius);
  padding: 0 var(--gap-tight);
  font-size: 0.75rem;
  color: var(--text-soft);
  transition: color var(--t-hover) ease;
}

@media (hover: hover) and (pointer: fine) {
  .pagelink:hover {
    color: var(--color-base-content);
  }
}

/*
 * Opacity and a little travel, both composited. The outgoing heading leaves
 * upward and the incoming one arrives from below, so the panel reads as one
 * thing moving forward through the flow rather than two things swapping.
 *
 * Split into two rules because the two halves are not the same job. `out-in`
 * runs them one after the other, so their durations add up — and the heading
 * *leaving* is not information. Measured at 220ms each, a press took 534ms to
 * settle, which is well past the point where an interface stops feeling like it
 * answered. The leave is the response and the enter is the answer: the response
 * snaps, the answer takes its time.
 */
.phase-enter-active {
  transition:
    opacity var(--t-pop) var(--ease-out),
    transform var(--t-pop) var(--ease-out);
}

.phase-leave-active {
  transition:
    opacity var(--t-press) var(--ease-out),
    transform var(--t-press) var(--ease-out);
}

.phase-enter-from {
  opacity: 0;
  transform: translateY(0.25rem);
}

.phase-leave-to {
  opacity: 0;
  transform: translateY(-0.25rem);
}

@media (prefers-reduced-motion: reduce) {
  .phase-enter-from,
  .phase-leave-to {
    transform: none;
  }
}
</style>
