<script setup lang="ts">
/**
 * The filter, as the conditions it is made of.
 *
 * It was four dropdowns in a drawer that folded away. Two things were wrong
 * with that. A dropdown per dimension puts every question on screen whether or
 * not it is being asked — four controls saying "any" is four controls' worth of
 * chrome reporting that nothing is happening — and folding them away to fix it
 * means the conditions narrowing the list are the one thing you cannot see.
 *
 * Chips invert both. Nothing is drawn until a condition exists, and every
 * condition that exists is drawn. What the list is showing is legible from the
 * list, which is the only place it matters.
 *
 * The third thing chips get right is the switch. Narrowing a log is iterative —
 * add a condition, look, take it off, look again — and a chip that crosses out
 * rather than vanishing makes "off" and "gone" two different gestures. Click
 * the body to disable, the cross to discard.
 */
import { computed, nextTick, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import {
  CHOICES,
  addCriterion,
  removeCriterion,
  toggleCriterion,
  type CriterionKind,
  type JobFilter,
} from '@shared/jobFilter';
import AppIcon from '../ui/AppIcon.vue';
import { useDismiss } from '../../composables/useDismiss';
import { vTip } from '../../lib/hoverTip';

const filter = defineModel<JobFilter>({ required: true });

/**
 * Which conditions this list can be narrowed by.
 *
 * The chips were built for the jobs and were the only filter in the window, so
 * every other panel either had none or had a bare text box. What differs
 * between two lists is not how a condition looks or behaves — it is which
 * questions that list can answer, which is exactly this.
 */
const props = withDefaults(defineProps<{ kinds?: readonly CriterionKind[] }>(), {
  kinds: () => ['status', 'started', 'finished', 'took'] as const,
});

const { t } = useTranslation();

const KINDS = computed(() => props.kinds);

const kindLabel = (kind: CriterionKind) => t(`jobs.kind${cap(kind)}`);
const valueLabel = (kind: CriterionKind, value: string) =>
  t(`jobs.${kind === 'status' ? 'status' : kind === 'took' ? 'took' : 'when'}${cap(value)}`);

function cap(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/* ----------------------------------------------------------------- adding */

const open = ref(false);
/**
 * Which question the popup is on.
 *
 * Both steps live in one popup rather than two, because they are one decision:
 * "status" on its own is not a filter, and a reader who picks it and then has to
 * find a second menu has been asked the same question twice. Choosing a kind
 * swaps the panel's contents; the panel itself does not move.
 */
const step = ref<CriterionKind | null>(null);
const panel = ref<HTMLElement>();

useDismiss(open);

function begin(): void {
  step.value = null;
  open.value = !open.value;
  if (open.value) void nextTick(() => panel.value?.focus());
}

function choose(value: string): void {
  if (!step.value) return;
  filter.value = addCriterion(filter.value, step.value, value);
  open.value = false;
}

function drop(at: number): void {
  filter.value = removeCriterion(filter.value, at);
}

function toggle(at: number): void {
  filter.value = toggleCriterion(filter.value, at);
}

const any = computed(() => filter.value.criteria.length > 0);
</script>

<template>
  <div class="chips">
    <TransitionGroup name="chip">
      <span
        v-for="(criterion, index) in filter.criteria"
        :key="`${criterion.kind}-${criterion.value}-${index}`"
        class="chip"
        :class="{ 'chip--off': !criterion.enabled }"
      >
        <!--
          The body is the switch. A crossed-out chip is a condition the reader
          has parked, which is a different thing from one they never added, and
          the difference has to survive being looked at.
        -->
        <button
          type="button"
          class="chip__body"
          :aria-pressed="criterion.enabled"
          :aria-label="
            t(criterion.enabled ? 'jobs.chipDisable' : 'jobs.chipEnable', {
              name: `${kindLabel(criterion.kind)}: ${valueLabel(criterion.kind, criterion.value)}`,
            })
          "
          @click="toggle(index)"
        >
          <span class="chip__kind">{{ kindLabel(criterion.kind) }}</span>
          <span class="chip__value">{{ valueLabel(criterion.kind, criterion.value) }}</span>
        </button>

        <button
          v-tip="$t('jobs.chipRemove')"
          type="button"
          class="chip__drop"
          :aria-label="$t('jobs.chipRemove')"
          @click="drop(index)"
        >
          <AppIcon name="close" :size="9" />
        </button>
      </span>
    </TransitionGroup>

    <div class="chips__add">
      <button
        type="button"
        class="chips__button"
        :class="{ 'chips__button--open': open }"
        :aria-expanded="open"
        :aria-label="$t('jobs.addFilter')"
        @click="begin"
      >
        <AppIcon name="plus" :size="10" />
        <span v-if="!any">{{ $t('jobs.addFilter') }}</span>
      </button>

      <Transition name="pop">
        <div v-if="open" ref="panel" class="picker surface-popover" tabindex="-1">
          <!--
            Step one and step two in the same box. The heading changes and the
            list changes; the box does not move, so the second choice is made
            where the eye already is.
          -->
          <p class="picker__head type-label">
            {{ step ? kindLabel(step) : $t('jobs.addFilterWhat') }}
          </p>

          <template v-if="!step">
            <button
              v-for="kind in KINDS"
              :key="kind"
              type="button"
              class="picker__row"
              @click="step = kind"
            >
              <span>{{ kindLabel(kind) }}</span>
              <AppIcon class="picker__caret" name="chevron" :size="10" />
            </button>
          </template>

          <template v-else>
            <button type="button" class="picker__row picker__row--back" @click="step = null">
              <AppIcon class="picker__back" name="chevron" :size="10" />
              <span>{{ $t('action.back') }}</span>
            </button>
            <button
              v-for="value in CHOICES[step]"
              :key="value"
              type="button"
              class="picker__row"
              @click="choose(value)"
            >
              {{ valueLabel(step, value) }}
            </button>
          </template>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gap-tight);
  padding: 0 var(--gap-tight) var(--gap-tight);
}

.chip {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  height: var(--hit-min);
  padding-inline-start: var(--gap);
  border-radius: 999px;
  background: color-mix(in oklab, var(--color-primary) 14%, transparent);
  font-size: 0.6875rem;
  transition:
    background-color var(--t-hover) var(--ease-out),
    opacity var(--t-hover) var(--ease-out);
}

/*
 * Crossed out rather than merely dimmed. Opacity alone reads as "loading" or
 * "unavailable"; a line through it is the one mark that unambiguously says
 * "this is here and is not counting".
 */
.chip--off {
  background: var(--fill-2);
  opacity: 0.6;
}

.chip--off .chip__body {
  text-decoration: line-through;
}

.chip__body {
  display: inline-flex;
  align-items: baseline;
  gap: 0.3em;
  min-width: 0;
  color: var(--color-primary-text, var(--color-primary));
}

.chip--off .chip__body {
  color: var(--color-base-content);
}

.chip__kind {
  opacity: 0.65;
}

.chip__value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

/*
 * The cross holds its space at all times and only becomes *visible* on hover.
 * Appearing from nothing would change the chip's width under the pointer, which
 * on a wrapping row moves every chip after it.
 */
.chip__drop {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 1.35rem;
  height: 100%;
  padding-inline-end: 0.2rem;
  border-radius: 0 999px 999px 0;
  opacity: 0;
  color: inherit;
  transition: opacity var(--t-hover) var(--ease-out);
}

.chip:hover .chip__drop,
.chip__drop:focus-visible {
  opacity: 0.8;
}

.chip__drop:hover {
  opacity: 1;
}

/* ------------------------------------------------------------- adding */

.chips__add {
  position: relative;
}

.chips__button {
  display: inline-flex;
  align-items: center;
  gap: var(--gap-tight);
  height: var(--hit-min);
  padding-inline: var(--gap);
  border: 1px dashed var(--separator);
  border-radius: 999px;
  font-size: 0.6875rem;
  color: color-mix(in oklab, var(--color-base-content) 60%, transparent);
  transition:
    background-color var(--t-hover) var(--ease-out),
    color var(--t-hover) var(--ease-out);
}

.chips__button:hover,
.chips__button--open {
  background: var(--fill-2);
  color: var(--color-base-content);
}

.picker {
  position: absolute;
  z-index: 60;
  inset-block-start: calc(100% + var(--gap-tight));
  inset-inline-start: 0;
  min-width: 11rem;
  padding: var(--gap-tight);
  border-radius: 0.75rem;
  outline: none;
}

.picker__head {
  padding: var(--gap-tight) var(--gap);
  opacity: 0.55;
}

.picker__row {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  width: 100%;
  height: var(--hit-min);
  padding-inline: var(--gap);
  border-radius: var(--radius-field);
  font-size: 0.75rem;
  text-align: start;
  color: var(--color-base-content);
}

.picker__row:hover {
  background: color-mix(in oklab, var(--color-primary) 16%, transparent);
  color: var(--color-primary-text, var(--color-primary));
}

.picker__caret {
  margin-inline-start: auto;
  opacity: 0.4;
}

.picker__row--back {
  opacity: 0.6;
}

.picker__back {
  transform: rotate(180deg);
}

/* Out of the button it was summoned from. */
.pop-enter-active,
.pop-leave-active {
  transition:
    transform var(--t-hover) var(--ease-out),
    opacity var(--t-press) var(--ease-out);
  transform-origin: top left;
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: scale(0.94);
}

.chip-enter-active,
.chip-leave-active {
  transition:
    transform var(--t-hover) var(--ease-out),
    opacity var(--t-press) var(--ease-out);
}

.chip-enter-from,
.chip-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

/* The survivors slide into the gap rather than jumping across it. */
.chip-move {
  transition: transform var(--t-hover) var(--ease-out);
}

@media (prefers-reduced-motion: reduce) {
  .chip,
  .chip__drop,
  .chips__button,
  .chip-move {
    transition: none;
  }

  .pop-enter-from,
  .pop-leave-to,
  .chip-enter-from,
  .chip-leave-to {
    transform: none;
  }
}
</style>
