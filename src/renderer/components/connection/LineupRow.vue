<script setup lang="ts">
/**
 * One line of the start screen's lineup.
 *
 * A saved connection, the sample database and "new connection" are the same
 * gesture — pick a thing, get a workspace — so they are one row rather than
 * three shapes that happen to sit under each other. What differs is the mark on
 * the left and whatever the row carries on the right, and both are arguments.
 *
 * The row is a container rather than a button because a connection carries
 * additional actions, and a button cannot hold a button.
 */
import type { EngineId } from '@drivers/types';
import AppIcon from '../ui/AppIcon.vue';
import EngineMark from './EngineMark.vue';

const props = withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    /**
     * The engine this row stands for, when it stands for one.
     *
     * It used to be a two-letter string and a hue, passed side by side, both
     * read out of the same descriptor by the caller — which is one fact in two
     * arguments and two chances to hand over a mark that does not match its
     * colour. The row takes the engine and reads both itself.
     */
    engine?: EngineId;
    /** An icon, for the rows that are an action rather than a database. */
    icon?: string;
    /** The accessible name, when the visible title is not the whole story. */
    label?: string;
    /** The connection's own colour, along the edge you read first. */
    accent?: string | null;
    /** Paths and hosts are read character by character; prose is not. */
    mono?: boolean;
    /**
     * When it was last opened, in its own trailing column.
     *
     * Its own field rather than the tail of the subtitle, because the two want
     * opposite things when the row is narrow: the host may be truncated to
     * nothing and still be recognisable, and "2h ago" truncated to "2h a…" is
     * just wrong. Joined into one string, the host pushed the time under the
     * action buttons, which is what the row looked like it was doing.
     */
    meta?: string;
    busy?: boolean;
  }>(),
  {
    subtitle: undefined,
    engine: undefined,
    icon: undefined,
    label: undefined,
    accent: undefined,
    mono: false,
    meta: undefined,
    busy: false,
  }
);

defineEmits<{ open: [] }>();
</script>

<template>
  <div
    class="row"
    :class="{ 'row--busy': busy }"
    :aria-busy="busy || undefined"
    :style="accent ? { '--label': accent } : undefined"
  >
    <button type="button" class="row__open" :aria-label="label" @click="$emit('open')">
      <span class="row__mark" aria-hidden="true">
        <AppIcon v-if="icon" :name="icon" :size="16" />
        <EngineMark v-else-if="engine" class="row__glyph" :engine="engine" :size="16" />
      </span>

      <span class="row__text">
        <span class="row__line">
          <span class="row__title">{{ title }}</span>
          <slot name="badge" />
        </span>

        <span v-if="subtitle" class="row__line">
          <span class="row__sub" :class="{ 'row__sub--mono': mono }">{{ subtitle }}</span>
        </span>
      </span>

      <span v-if="meta || !$slots.actions" class="row__trailing">
        <span v-if="meta" class="row__meta">{{ meta }}</span>
        <AppIcon v-if="!$slots.actions" class="row__chevron" name="chevron" :size="16" />
      </span>
    </button>

    <!--
      In the row's flow rather than floating over its end.
      ────────────────────────────────────────────────────
      They were absolutely positioned, so the text beneath ran on underneath
      them and the last thing on the line — the time — was printed behind three
      buttons. Occupying real space means the text has somewhere to stop; the
      space is reserved whether or not they are showing, so nothing moves when
      the pointer arrives.
    -->
    <div v-if="$slots.actions" class="row__actions">
      <slot name="actions" />
    </div>

    <span v-if="busy" class="row__activity" aria-hidden="true">
      <span class="row__progress" />
    </span>
  </div>
</template>

<style scoped>
/*
 * The row is a grid, not a button with things floated over it.
 *
 * One track for the thing you press and one for what you can do to it, so the
 * two cannot land on top of each other however long the host name is.
 */
.row {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  isolation: isolate;
}

.row::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  background: var(--fill-2);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--t-hover) var(--ease-out);
}

/* The connection's own colour, along the edge you read first. */
.row::before {
  content: '';
  position: absolute;
  inset-block: var(--gap-loose);
  inset-inline-start: 0;
  width: 2px;
  border-radius: var(--radius-field);
  background: var(--label, transparent);
}

/* Rows follow the desktop density scale, regardless of window size. */
.row__open {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--gap-loose);
  width: 100%;
  /* A grid item will not shrink below its content either, so the chain of
     min-widths has to run all the way from the row to the text. */
  min-width: 0;
  min-height: max(calc(var(--hit-min) + var(--gap-loose)), calc(3.5rem * var(--density)));
  padding: var(--gap) var(--gap-loose);
  text-align: start;
  font-size: 0.8125rem;
}

.row__mark {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-field);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-soft);
  background: var(--fill-2);
  transition: transform var(--t-hover) var(--ease-out);
}

/* Engine glyphs and action icons share one optical size, including fallbacks. */
.row__glyph {
  font-size: 0.6875rem;
}

.row__glyph.mark,
.row__mark .mark {
  width: 1rem;
  height: 1rem;
}

/* The icon is drawn at a fixed pixel size, so it is the one thing in the row
   that would not grow with it. */
.row__mark .icon {
  width: 1rem;
  height: 1rem;
}

.row__text {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
  min-width: 0;
  flex: 1;
}

/*
 * Two lines, each with something that may be long and something that must not
 * be cut. The long half shrinks; the short half keeps its width.
 */
.row__line {
  display: flex;
  align-items: baseline;
  gap: 0.5em;
  min-width: 0;
}

.row__trailing {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--gap);
  min-width: 0;
}

/* When it was last opened. Tabular so a column of them lines up, and never
   allowed to shrink — a truncated duration is a wrong duration. */
.row__meta {
  flex: 0 0 auto;
  font-size: 0.6875rem;
  line-height: 1.4;
  font-variant-numeric: tabular-nums;
  color: var(--text-soft);
  white-space: nowrap;
}

.row__title {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: -0.006em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row__sub {
  /* A flex child will not shrink below its content unless told it may, and a
     host name is exactly the content that has to. */
  flex: 0 1 auto;
  min-width: 0;
  font-size: 0.6875rem;
  line-height: 1.35;
  color: var(--text-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row__sub--mono {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
}

/*
 * The chevron points where the row is going; its small travel reinforces that
 * direction without moving the label or the click target.
 */
.row__chevron {
  flex: 0 0 auto;
  width: 1em;
  height: 1em;
  color: var(--text-soft);
  transition: transform var(--t-hover) var(--ease-out);
}

.row__actions {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  padding-inline-end: var(--gap-loose);
}

/* A line that sweeps the row while the connection opens: "working", without
   taking any space or moving anything else. */
.row__activity {
  position: absolute;
  inset-block-end: 1px;
  inset-inline: var(--gap-loose);
  height: 2px;
  overflow: hidden;
  border-radius: var(--radius-field);
}
.row__progress {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, transparent, var(--color-primary), transparent);
  animation: row-sweep 1.1s var(--ease-in-out) infinite;
}

@keyframes row-sweep {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(100%);
  }
}

.row--busy {
  background: color-mix(in oklab, var(--color-primary) 8%, transparent);
}

.row .row__open:active .row__mark {
  transform: scale(0.94);
  transition-duration: var(--t-press);
}
.row:focus-within::after {
  opacity: 1;
  transition: none;
}

@media (hover: hover) and (pointer: fine) {
  .row:hover::after {
    opacity: 1;
  }

  .row:hover .row__mark {
    transform: scale(1.04);
  }

  .row:hover .row__chevron {
    transform: translateX(2px);
    color: var(--text-soft);
  }
}

/* Keyboard focus changes immediately; only pointer feedback carries motion. */
.row__open:focus-visible .row__mark,
.row__open:focus-visible .row__chevron {
  transform: none;
  transition: none;
}

@media (prefers-reduced-motion: reduce) {
  .row:hover .row__mark,
  .row:hover .row__chevron,
  .row .row__open:active .row__mark {
    transform: none;
  }

  .row__progress {
    animation: none;
    opacity: 0.6;
  }
}
</style>
