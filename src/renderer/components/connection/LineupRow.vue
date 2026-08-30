<script setup lang="ts">
/**
 * One line of the start screen's lineup.
 *
 * A saved connection, the sample database and "new connection" are the same
 * gesture — pick a thing, get a workspace — so they are one row rather than
 * three shapes that happen to sit under each other. What differs is the mark on
 * the left and whatever the row carries on the right, and both are arguments.
 *
 * The row is a container rather than a button because a connection carries two
 * more actions, and a button cannot hold a button.
 */
import { computed } from 'vue';
import type { EngineId } from '@drivers/types';
import { engineDescriptor } from '@shared/engines';
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
     * The short fact at the end of the second line — when it was last opened.
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

/** The tile's colour, which is the engine's — absent, it stays neutral fill. */
const hue = computed(() => (props.engine ? engineDescriptor(props.engine).hue : undefined));
</script>

<template>
  <div
    class="row"
    :class="{ 'row--busy': busy }"
    :style="accent ? { '--label': accent } : undefined"
  >
    <button type="button" class="row__open" :aria-label="label" @click="$emit('open')">
      <span
        class="row__mark"
        :class="{ 'row__mark--engine': hue !== undefined }"
        :style="hue !== undefined ? { '--engine-hue': hue } : undefined"
        aria-hidden="true"
      >
        <AppIcon v-if="icon" :name="icon" :size="16" />
        <EngineMark v-else-if="engine" class="row__glyph" :engine="engine" :size="16" />
      </span>

      <span class="row__text">
        <span class="row__line">
          <span class="row__title">{{ title }}</span>
          <slot name="badge" />
        </span>

        <span v-if="subtitle || meta" class="row__line row__line--sub">
          <span v-if="subtitle" class="row__sub" :class="{ 'row__sub--mono': mono }">{{
            subtitle
          }}</span>
          <span v-if="meta" class="row__meta">{{ meta }}</span>
        </span>
      </span>

      <AppIcon class="row__chevron" name="chevron" :size="16" />
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

    <span v-if="busy" class="row__progress" aria-hidden="true" />
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
  grid-template-columns: 1fr auto;
  align-items: center;
  transition: background-color var(--t-hover) var(--ease-out);
}

/* The connection's own colour, along the edge you read first. */
.row::before {
  content: '';
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  width: 3px;
  background: var(--label, transparent);
}

/*
 * Sized in `em` rather than in fixed rem.
 *
 * The start screen sets one font-size from the size of the window, so a row
 * grows with it and a large window gets a large lineup instead of the same
 * small one adrift in the middle. The floor is still the density scale's: `em`
 * here bottoms out at the column's own clamp, which is in rem, so an enlarged
 * OS text size scales this with it.
 */
.row__open {
  display: flex;
  align-items: center;
  gap: 0.75em;
  width: 100%;
  /* A grid item will not shrink below its content either, so the chain of
     min-widths has to run all the way from the row to the text. */
  min-width: 0;
  min-height: max(calc(var(--hit-min) + var(--gap)), 2.7em);
  padding: 0.5em 0.75em;
  text-align: start;
}

.row__mark {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 2.2em;
  height: 2.2em;
  border-radius: 0.66em;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: color-mix(in oklab, var(--color-base-content) 65%, transparent);
  background: var(--fill-3);
  transition: transform var(--t-hover) var(--ease-out);
}

/*
 * An engine gets its own colour, so staging and production are told apart
 * before either name has been read.
 */
.row__mark--engine {
  color: oklch(99% 0 0);
  background: linear-gradient(
    145deg,
    oklch(64% 0.16 var(--engine-hue)),
    oklch(52% 0.17 var(--engine-hue))
  );
  box-shadow: inset 0 1px 0 oklch(100% 0 0 / 0.3);
}

/*
 * The mark grows with the row, like the icon beside it does.
 *
 * `EngineMark` takes a pixel size because two of its three callers are fixed
 * tiles; this row is the one that is sized in `em` all the way down, so the
 * drawn mark is overridden here and the fallback letters take their size from
 * the same place they always did.
 */
.row__glyph {
  font-size: 0.66em;
}

.row__glyph.mark,
.row__mark .mark {
  width: 1.15em;
  height: 1.15em;
}

/* The icon is drawn at a fixed pixel size, so it is the one thing in the row
   that would not grow with it. */
.row__mark .icon {
  width: 1.1em;
  height: 1.1em;
}

.row__text {
  display: flex;
  flex-direction: column;
  gap: 0.1em;
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

.row__line--sub {
  justify-content: space-between;
}

/* When it was last opened. Tabular so a column of them lines up, and never
   allowed to shrink — a truncated duration is a wrong duration. */
.row__meta {
  flex: 0 0 auto;
  font-size: 0.75em;
  font-variant-numeric: tabular-nums;
  color: var(--text-soft);
  white-space: nowrap;
}

.row__title {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 0.95em;
  font-weight: 550;
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
  font-size: 0.8em;
  line-height: 1.35;
  color: var(--text-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row__sub--mono {
  font-family: var(--font-mono);
  font-size: 0.75em;
}

/*
 * The chevron points where the row is going. It is the only thing that moves on
 * hover, which is what makes the movement mean something.
 */
.row__chevron {
  flex: 0 0 auto;
  width: 1em;
  height: 1em;
  color: var(--text-soft);
  transition:
    transform var(--t-hover) var(--ease-out),
    opacity var(--t-hover) var(--ease-out),
    color var(--t-hover) var(--ease-out);
}

.row__actions {
  display: flex;
  align-items: center;
  gap: 0.2em;
  padding-inline-end: 0.5em;
  opacity: 0;
  transition: opacity var(--t-hover) var(--ease-out);
}

/* A line that sweeps the row while the connection opens: "working", without
   taking any space or moving anything else. */
.row__progress {
  position: absolute;
  inset-block-end: 0;
  inset-inline: 0;
  height: 2px;
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

.row:active:not(.row--busy) {
  background: var(--fill-2);
}

@media (hover: hover) and (pointer: fine) {
  .row:hover {
    background: var(--fill-3);
  }

  .row:hover .row__mark {
    transform: scale(1.06);
  }

  .row:hover .row__chevron {
    transform: translateX(2px);
    color: var(--text-soft);
  }

  /*
   * The actions take the chevron's place rather than crowding beside it.
   *
   * Only the opacity moves. They were given a few pixels of travel as well,
   * which is a box that changes position under a pointer already on its way to
   * it — the one place in the interface where a flourish costs a click.
   */
  .row:hover .row__actions,
  .row:focus-within .row__actions {
    opacity: 1;
  }

  /*
   * A row that carries actions does not carry a chevron as well: two things
   * pointing at the end of the same row, one of which appears only sometimes.
   * The chevron stays on the rows that are a single destination.
   */
  .row:has(.row__actions) .row__chevron {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .row:hover .row__mark,
  .row:hover .row__chevron {
    transform: none;
  }

  .row__progress {
    animation: none;
    opacity: 0.6;
  }
}
</style>
