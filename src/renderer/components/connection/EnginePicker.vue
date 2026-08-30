<script setup lang="ts">
/**
 * The engine picker.
 *
 * Every engine is presented identically — same size, same weight, same
 * treatment. There is no tiering here because there is no tiering in the
 * product: all nine are equally supported and equally free.
 */
import type { EngineId } from '@drivers/types';
import EngineMark from './EngineMark.vue';
import { ENGINES } from '@shared/engines';

const model = defineModel<EngineId | null>({ required: true });
</script>

<template>
  <div class="engines" role="radiogroup" :aria-label="$t('connection.engineLabel')">
    <button
      v-for="engine in ENGINES"
      :key="engine.id"
      type="button"
      class="engine"
      :class="{ 'engine--on': model === engine.id }"
      :style="{ '--engine-hue': engine.hue }"
      role="radio"
      :aria-checked="model === engine.id"
      @click="model = engine.id"
    >
      <span class="engine__mark" aria-hidden="true">
        <EngineMark :engine="engine.id" :size="14" />
      </span>
      <span class="engine__name">{{ engine.name }}</span>
    </button>
  </div>
</template>

<style scoped>
/*
 * A row of chips, not a wall of tiles.
 *
 * Nine cards two rows deep took seven tenths of the popup for one field, and
 * pushed the host and the password — the things actually being filled in —
 * under the fold behind a scrollbar. The engine is one decision among several
 * here, so it is the size of a field, and the marks still carry the colours
 * that make an engine recognisable before its name is read.
 */
/*
 * One grid, equal columns, rather than a row that wraps.
 *
 * Nine names of nine different lengths laid out at their natural widths make
 * nine different boxes and two ragged rows — a shape the eye has to parse
 * before it can read any of it. On a grid the cells are identical and the only
 * thing that varies is the word inside, which is the thing being chosen.
 *
 * `auto-fill` rather than a fixed count, so the same rule holds in a narrow
 * window and at a larger text size: the columns get fewer, never thinner than a
 * name can sit in.
 */
.engines {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
  gap: var(--gap-tight);
}

.engine {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  min-height: var(--hit-min);
  padding: var(--gap-hair) var(--gap);
  border-radius: var(--radius-box);
  border: 1px solid transparent;
  background-color: var(--fill-4);
  transition:
    transform var(--t-press) var(--ease-out),
    border-color var(--t-hover) var(--ease-out),
    background-color var(--t-hover) var(--ease-out);
}

.engine:active {
  transform: scale(0.96);
}

/*
 * The selected engine is marked by a filled surface and its own mark growing,
 * not by a ring — a ring around a card reads as a focus artefact rather than a
 * choice.
 */
.engine--on {
  border-color: color-mix(in oklab, var(--color-primary) 45%, transparent);
  background-color: color-mix(in oklab, var(--color-primary) 12%, transparent);
}

.engine--on .engine__mark {
  transform: scale(1.08);
}

.engine--on .engine__name {
  color: var(--color-primary-text, var(--color-primary));
  font-weight: 600;
}

.engine__mark {
  display: grid;
  place-items: center;
  flex: none;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 0.4rem;
  font-size: 0.5rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: oklch(99% 0 0);
  /* A slight gradient and a bright top edge give the mark a surface. */
  background: linear-gradient(
    145deg,
    oklch(64% 0.16 var(--engine-hue)),
    oklch(52% 0.17 var(--engine-hue))
  );
  box-shadow: inset 0 1px 0 oklch(100% 0 0 / 0.32);
  transition: transform var(--t-pop) var(--ease-out);
}

.engine__name {
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
  color: color-mix(in oklab, var(--color-base-content) 68%, transparent);
  transition: color var(--t-hover) var(--ease-out);
}

/*
 * Hover changes the surface; being chosen changes the mark and the name.
 *
 * Both used to scale the mark to exactly 1.08, so pointing at an unselected
 * chip made it look selected — nine chips where the one under the pointer and
 * the one actually chosen were drawn identically. And the surface did not
 * change at all: `.engine` already sits on `--fill-4`, so a hover rule setting
 * `--fill-4` was a rule that computed to the value it was replacing. Measured,
 * the background was the same colour before and after.
 *
 * One signal each now. `--fill-3` is the next step up the ramp rather than a
 * hand-mixed tint, so the chip lifts by the same amount every other hoverable
 * surface in the app lifts by.
 */
@media (hover: hover) and (pointer: fine) {
  .engine:hover:not(.engine--on) {
    background-color: var(--fill-3);
  }
}

/*
 * No reduced-motion block, and that is deliberate.
 *
 * `base.css` already takes `transform` out of `transition-property` there, so
 * nothing *moves*: the press and the chosen mark still take their size, they
 * just take it at once. That is what reduced motion asks for — fewer and
 * gentler, not none — and a press that stops answering is the interface going
 * quiet on the one gesture that most needs an answer.
 *
 * The block that used to be here tried to remove both and managed neither:
 * `transform: none` on `.engine__mark` lost to `.engine--on .engine__mark` on
 * specificity, and its `transition-duration` lost to the `!important` in
 * `base.css`. Two rules that read as care and did nothing.
 */
</style>
