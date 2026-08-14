<script setup lang="ts">
/**
 * The engine picker.
 *
 * Every engine is presented identically — same size, same weight, same
 * treatment. There is no tiering here because there is no tiering in the
 * product: all nine are equally supported and equally free.
 */
import type { EngineId } from '@drivers/types';
import { ENGINES } from '@shared/engines';

const model = defineModel<EngineId | null>({ required: true });
</script>

<template>
  <div
    class="engines"
    role="radiogroup"
    aria-label="Database engine"
  >
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
      <span
        class="engine__mark"
        aria-hidden="true"
      >{{ engine.mark }}</span>
      <span class="engine__name">{{ engine.name }}</span>
    </button>
  </div>
</template>

<style scoped>
.engines {
  display: grid;
  /* Five across leaves nine engines as 5 + 4 rather than a lone straggler. */
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--gap-tight);
}

.engine {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: var(--gap) var(--gap-tight);
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
  width: 1.875rem;
  height: 1.875rem;
  border-radius: 0.6rem;
  font-size: 0.6875rem;
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
  font-size: 0.625rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  text-align: center;
  color: color-mix(in oklab, var(--color-base-content) 68%, transparent);
  transition: color var(--t-hover) var(--ease-out);
}

@media (hover: hover) and (pointer: fine) {
  .engine:hover:not(.engine--on) {
    background: var(--fill-4);
  }

  .engine:hover .engine__mark {
    transform: scale(1.08);
  }
}

@media (prefers-reduced-motion: reduce) {
  .engine__mark,
  .engine:active {
    transform: none;
    transition-duration: 120ms;
  }
}
</style>
