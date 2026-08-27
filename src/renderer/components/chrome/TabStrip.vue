<script setup lang="ts">
/**
 * The tab strip.
 *
 * One selection that travels, rather than a surface each tab paints for itself.
 * That is what makes a row of tabs read as positions on one axis instead of as
 * several controls that happen to be adjacent — the same reason the rail moves
 * its marker rather than blinking it on and off.
 *
 * It also removes the shape that was wrong. The open tab used to be the raised
 * white thumb of a segmented control, and a raised thumb needs the recessed
 * track it is raised *out of* to be legible as raised. The strip is a region of
 * the top bar now, and the bar may not carry a tint of its own — so there is no
 * track, and a thumb with no track is a card hovering over nothing. Loudness
 * carries the difference instead: quiet by default, a tonal surface for the one
 * that is open.
 *
 * Tabs reorder by dragging one-to-one with the pointer: the dragged tab follows
 * the finger exactly while its neighbours spring aside, so the reorder reads as
 * moving a physical thing rather than as a list re-sorting itself.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useTabs, type Tab } from '../../stores/tabs';
import { useDrag } from '../../composables/useDrag';
import { useTranslation } from 'i18next-vue';
import { shortcutLabel } from '../../lib/keybindings';
import { vTip } from '../../lib/hoverTip';
import AppIcon from '../ui/AppIcon.vue';
import ContextMenu, { type MenuItem } from '../ui/ContextMenu.vue';

const tabs = useTabs();
const { t } = useTranslation();

/**
 * Which tab the pointer went down on, and where it has carried it.
 *
 * Whether a drag is *happening* is `useDrag`'s to say, not this component's.
 * Holding a second copy of that here is what left a tab lifted after a plain
 * click: a press that never crosses the movement threshold is not a drag, so
 * the release hook is never called, so the index this file set on pointerdown
 * was never cleared. Derived from `dragging`, there is no second copy to fall
 * out of step.
 */
const heldIndex = ref<number | null>(null);
const dragOffset = ref(0);
const stripEl = ref<HTMLElement>();
const listEl = ref<HTMLElement>();

/** Measured on grab so a density change never desyncs the reorder maths. */
let tabWidth = 160;

/**
 * How many places the held tab has already been moved this drag.
 *
 * The one number the reorder cannot be done without, and it was missing. The
 * drag reports the *total* distance from where the pointer went down, so the
 * number of places to move is `round(total / width)` — but the list had already
 * been rearranged by the previous frame, so that same total was applied again
 * against the tab's *new* index, and again the frame after. One tab-width of
 * travel moved a tab two places, two widths moved it four, and a tab dragged
 * across a strip of four ran off the end and stopped.
 *
 * Keeping the count is what makes the two agree: what the pointer has asked for
 * is a function of the total, what has been done is this, and the difference is
 * what to do now.
 */
let shifted = 0;

/**
 * Where the tab was picked up from, which is what the travel is measured
 * against.
 *
 * Not `heldIndex`: that moves as the list rearranges, so bounds derived from it
 * shrink under the drag and clamp it after a single place — the tab stopped
 * dead one slot from where it started while the pointer carried on.
 */
let grabIndex = 0;

/**
 * Where the selection sits, in the list's own coordinates.
 *
 * Measured rather than stepped, because tabs are as wide as their titles. The
 * rail can multiply an index by a row height; this cannot.
 */
const marker = ref<{ x: number; width: number } | null>(null);

/**
 * Where the marker belongs, worked out rather than read off the page.
 *
 * It used to be measured, and the comment said why: tabs were as wide as their
 * titles, so nothing but the box itself could say where one ended. They are all
 * one width now, and measuring became the wrong tool the moment that width
 * started animating — a box read mid-flight is the width the tabs are *passing
 * through*, so the marker chased a target that had already moved and settled
 * beside the tab rather than on it.
 *
 * Arithmetic has neither problem: every tab is `--tab-w` and every gap is the
 * same, so the nth tab starts at n × (width + gap). It is exact at every frame
 * of the resize, which is what lets the two animate together.
 */
function measure(): void {
  const list = listEl.value;
  const index = tabs.tabs.findIndex((tab) => tab.id === tabs.activeId);

  if (!list || index < 0 || tabSize.value === 0) {
    marker.value = null;
    return;
  }

  const gap = Number.parseFloat(getComputedStyle(list).gap) || 0;
  marker.value = { x: index * (tabSize.value + gap), width: tabSize.value };
}

/**
 * The marker follows the tab being dragged rather than staying where the tab
 * used to be — it is the same object, and one of them arriving late would say
 * the selection and the tab are two things.
 */
const markerStyle = computed(() => {
  const at = marker.value;
  if (!at) return undefined;

  const activeIndex = tabs.tabs.findIndex((tab) => tab.id === tabs.activeId);
  const held = dragIndex.value !== null && dragIndex.value === activeIndex;

  return {
    transform: `translateX(${at.x + (held ? dragOffset.value : 0)}px)`,
    width: `${at.width}px`,
  };
});

const { start, dragging } = useDrag({
  axis: 'x',
  getValue: () => 0,
  /*
   * The pointer is captured on the strip, not on the tab.
   *
   * Applying a reorder moves the dragged tab in the DOM, and a node that leaves
   * the document — even for the instant it takes to reinsert it — loses its
   * capture. So the first reorder landed and the gesture died there: a tab
   * could be carried exactly one place, and the pointer went on travelling with
   * nothing following it. The strip does not move.
   */
  surface: () => stripEl.value,
  /*
   * The ends of the strip resist rather than stop.
   *
   * The travel a tab has is the distance to the first slot and the distance to
   * the last, both measured from where it was picked up. Past those there is
   * nowhere for it to go — and a tab that simply freezes under a moving pointer
   * reads as the drag having been dropped, where one that follows with
   * increasing reluctance reads as the end of the row, which is what it is.
   */
  bounds: () => ({
    min: -grabIndex * tabWidth,
    max: (tabs.tabs.length - 1 - grabIndex) * tabWidth,
  }),
  onDrag: ({ value }) => {
    if (heldIndex.value !== null) {
      // What the pointer is asking for, against what has already been done.
      const wanted = Math.round(value / tabWidth);
      const target = heldIndex.value + (wanted - shifted);

      if (wanted !== shifted && target >= 0 && target < tabs.tabs.length) {
        tabs.move(heldIndex.value, target);
        heldIndex.value = target;
        shifted = wanted;
      }
    }

    // Re-anchored by however far the list has moved under it, so the tab stays
    // under the pointer rather than running away from it a width at a time.
    dragOffset.value = value - shifted * tabWidth;
  },
  onRelease: () => {
    heldIndex.value = null;
    shifted = 0;
    dragOffset.value = 0;
    void nextTick(measure);
  },
});

const dragIndex = computed(() => (dragging.value ? heldIndex.value : null));

function beginDrag(event: PointerEvent, index: number): void {
  const element = (event.currentTarget as HTMLElement).getBoundingClientRect();
  tabWidth = element.width || tabWidth;
  heldIndex.value = index;
  grabIndex = index;
  shifted = 0;
  dragOffset.value = 0;
  start(event);
}

/* ------------------------------------------------------------------ new tab */

const newButton = ref<HTMLElement>();
const newMenuOpen = ref(false);
const newMenuAt = ref({ x: 0, y: 0 });

const newMenuItems = computed<MenuItem[]>(() => [
  {
    id: 'query',
    label: t('workspace.newQuery'),
    icon: 'query',
    hint: shortcutLabel('tab.new'),
  },
  {
    id: 'chat',
    label: t('assistant.newChat'),
    icon: 'assistant',
    hint: shortcutLabel('assistant.open'),
  },
]);

/** Under the button, so the menu is visibly that button's. */
function openNewMenu(): void {
  const box = newButton.value?.getBoundingClientRect();
  if (box) newMenuAt.value = { x: box.left, y: box.bottom + 4 };
  newMenuOpen.value = true;
}

function onNewChoose(id: string): void {
  if (id === 'query') tabs.openQuery();
  else if (id === 'chat') tabs.openChat();
}

/* ----------------------------------------------------------------- renaming */

const renaming = ref<string | null>(null);
const draftTitle = ref('');
/*
 * A callback ref, because this input is inside the `v-for` over the tabs: a
 * string ref there collects into an *array* of every element that carried it,
 * and the one we want is whichever tab is being renamed. Only one exists at a
 * time, so the callback is the whole of the bookkeeping.
 */
let renameField: HTMLInputElement | null = null;

function bindRenameField(el: unknown): void {
  renameField = (el as HTMLInputElement | null) ?? null;
}

function beginRename(tab: Tab): void {
  renaming.value = tab.id;
  draftTitle.value = tab.title;
  void nextTick(() => {
    renameField?.focus();
    renameField?.select();
  });
}

function commitRename(): void {
  const id = renaming.value;
  if (!id) return;

  // Cleared first: committing focuses something else, and a blur handler that
  // fires while the field is still the one being renamed commits twice.
  renaming.value = null;
  tabs.rename(id, draftTitle.value);
}

function onAuxClick(event: MouseEvent, tab: Tab): void {
  // Middle click closes, which is the convention everywhere tabs exist.
  if (event.button === 1) {
    event.preventDefault();
    closeTab(tab.id);
  }
}

/*
 * A title changing length, the density scale changing, or the UI font arriving
 * all move the tabs without the list itself changing. Watching the store would
 * miss every one of them.
 */
/**
 * One width for every tab, worked out the way a browser works it out.
 *
 * `flex: 1 1 0` divides the space equally, which is the right *result* — but it
 * requires the tablist to fill the strip, and a full-width tablist pushes the
 * new-tab button to the far edge of the window, a hand-span from the tab it
 * belongs after. Chrome puts it immediately after the rightmost tab, which is
 * where you look for it.
 *
 * So the width is computed and the tablist is sized by its contents: every tab
 * gets `(room − the new-tab button) / count`, clamped between the density
 * scale's floor and ceiling. Below the floor they stop shrinking and the strip
 * scrolls instead of grinding them into slivers.
 */
const tabSize = ref(0);

/**
 * Tabs that have just been opened, so they can arrive rather than appear.
 *
 * A new tab used to be there in one frame at full width while every other tab
 * animated to make room for it — so the row moved and the newcomer did not,
 * which reads as the tabs getting out of the way of something that was already
 * there. It grows out of nothing and fades up instead, on the same curve and
 * over the same time as the shuffle it causes.
 */
const entering = ref(new Set<string>());
const enterTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** As long as the width transition it runs alongside. */
const ENTER_MS = 260;

/**
 * Closing, held for the length of the animation.
 *
 * A tab removed from the store is gone from the DOM in the same frame, so it
 * cannot animate out — the row simply closes over the gap. The removal waits
 * instead: the tab shrinks to nothing and fades, and only then is it actually
 * closed. Out faster than in, because the reader has already decided.
 */
const leaving = ref(new Set<string>());
const leaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

const LEAVE_MS = 180;

function closeTab(id: string): void {
  if (leaving.value.has(id)) return;

  leaving.value = new Set(leaving.value).add(id);
  leaveTimers.set(
    id,
    setTimeout(() => {
      const next = new Set(leaving.value);
      next.delete(id);
      leaving.value = next;
      leaveTimers.delete(id);
      tabs.close(id);
    }, LEAVE_MS)
  );
}

function markEntering(id: string): void {
  entering.value = new Set(entering.value).add(id);

  clearTimeout(enterTimers.get(id));
  enterTimers.set(
    id,
    setTimeout(() => {
      const next = new Set(entering.value);
      next.delete(id);
      entering.value = next;
      enterTimers.delete(id);
    }, ENTER_MS)
  );
}

/*
 * Compared against what was there rather than against the count: a tab can be
 * opened and another closed in the same turn, and the length would not move.
 */
let known = new Set<string>();

watch(
  () => tabs.tabs.map((tab) => tab.id).join('\u0000'),
  () => {
    const now = new Set(tabs.tabs.map((tab) => tab.id));
    // Nothing animates on the first render: a restored session is not five
    // tabs being created, it is five tabs that were already open.
    if (known.size > 0) {
      for (const id of now) if (!known.has(id)) markEntering(id);
    }
    known = now;
  },
  { immediate: true }
);

/** Read from the stylesheet, so density still governs the two bounds. */
function bound(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return fallback;
  return raw.trim().endsWith('rem')
    ? value * Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
    : value;
}

function sizeTabs(): void {
  const strip = stripEl.value;
  const count = tabs.tabs.length;
  if (!strip || count === 0) return;

  const min = bound('--tab-min', 104);
  const max = bound('--tab-max', 208);

  const newButton = strip.querySelector<HTMLElement>('.strip__new');
  const gap = Number.parseFloat(getComputedStyle(strip).gap) || 0;
  const room = strip.clientWidth - (newButton?.offsetWidth ?? 0) - gap * (count + 1);

  tabSize.value = Math.round(Math.max(min, Math.min(max, room / count)));
}

/**
 * Widths first, then the marker — with a frame in between.
 *
 * `sizeTabs` writes a reactive value that becomes a CSS custom property, and
 * the DOM does not carry it until Vue has flushed. Measuring in the same turn
 * reads the geometry the tabs had *before* the new width, so opening a tab left
 * the marker sized and placed for the old layout: a white slab hanging off the
 * end of the last tab, or sitting over the tab before the open one.
 */
async function relayout(): Promise<void> {
  sizeTabs();
  await nextTick();
  measure();
}

watch(
  () => tabs.tabs.length,
  () => void relayout()
);

let observer: ResizeObserver | undefined;

onMounted(() => {
  void relayout();
  observer = new ResizeObserver(() => void relayout());
  if (stripEl.value) observer.observe(stripEl.value);
  if (listEl.value) observer.observe(listEl.value);
  measure();
});

onBeforeUnmount(() => {
  observer?.disconnect();
  for (const timer of [...enterTimers.values(), ...leaveTimers.values()]) clearTimeout(timer);
  enterTimers.clear();
  leaveTimers.clear();
});

watch(
  [() => tabs.activeId, () => tabs.tabs.length, () => dragIndex.value],
  () => void nextTick(measure),
  { flush: 'post' }
);

/*
 * Every kind, exhaustively. Typed as a total record so that adding a tab kind
 * and forgetting its glyph is a compile error rather than a tab with a blank
 * square where its icon goes — which is how `job` shipped without one.
 */
const KIND_ICON: Record<Tab['kind'], string> = {
  table: 'table',
  query: 'query',
  erd: 'diagram',
  job: 'jobs',
  chat: 'assistant',
};
</script>

<template>
  <div
    ref="stripEl"
    class="strip panel-content drag-region"
  >
    <!--
      The tablist holds tabs and nothing else. The new-tab button used to sit
      inside it, which makes assistive technology announce a control that is not
      one of the tabs as though it were one.
    -->
    <div
      ref="listEl"
      class="strip__tabs"
      role="tablist"
      :style="{ '--tab-w': tabSize ? `${tabSize}px` : undefined }"
    >
      <span
        v-if="marker"
        class="strip__marker"
        :class="{ 'strip__marker--held': dragIndex !== null }"
        :style="markerStyle"
        aria-hidden="true"
      />

      <div
        v-for="(tab, index) in tabs.tabs"
        :key="tab.id"
        class="striptab no-drag"
        :class="{
          'striptab--on': tab.id === tabs.activeId,
          'striptab--dragging': dragIndex === index,
          'striptab--entering': entering.has(tab.id),
          'striptab--leaving': leaving.has(tab.id),
        }"
        :style="dragIndex === index ? { transform: `translateX(${dragOffset}px)` } : undefined"
        role="tab"
        :aria-selected="tab.id === tabs.activeId"
        tabindex="0"
        @pointerdown="
          tabs.focus(tab.id);
          beginDrag($event, index);
        "
        @auxclick="onAuxClick($event, tab)"
        @dblclick="beginRename(tab)"
        @keydown.delete="closeTab(tab.id)"
      >
        <AppIcon
          class="striptab__mark"
          :name="KIND_ICON[tab.kind]"
          :size="12"
        />
        <!--
          The name, and the field it becomes.
          ──────────────────────────────────
          Double-click renames it in place, the way a file is renamed: the text
          you were reading is the text you are now editing, in the same position
          and at the same size, so nothing moves under the pointer that opened
          it. Return commits, Escape puts it back, and clicking away commits —
          which is what every rename-in-place on the platform does, because
          having typed a name and looked elsewhere is not an instruction to
          discard it.
        -->
        <input
          v-if="renaming === tab.id"
          :ref="(el) => bindRenameField(el)"
          v-model="draftTitle"
          class="striptab__title striptab__rename"
          spellcheck="false"
          :aria-label="`Rename ${tab.title}`"
          @pointerdown.stop
          @dblclick.stop
          @keydown.enter.prevent="commitRename()"
          @keydown.esc.prevent="renaming = null"
          @blur="commitRename()"
        >
        <span
          v-else
          class="striptab__title"
        >{{ tab.title }}</span>
        <span
          v-if="tab.subtitle"
          class="striptab__scope"
        >{{ tab.subtitle }}</span>

        <!--
          The dot is the unsaved mark and the cross is the action, in one place
          because they are one place on every other tabbed interface: the mark
          you are looking at is the target you are already aiming for.
        -->
        <button
          class="striptab__close"
          :class="{ 'striptab__close--unsaved': tab.unsaved }"
          :aria-label="`Close ${tab.title}`"
          @pointerdown.stop
          @click.stop="closeTab(tab.id)"
        >
          <span
            v-if="tab.unsaved"
            class="striptab__dot"
            aria-hidden="true"
          />
          <AppIcon
            class="striptab__cross"
            name="close"
            :size="9"
          />
        </button>
      </div>
    </div>

    <!--
      The plus asks which kind.
      ────────────────────────
      There are two kinds of tab and one button that made one of them, so the
      other kind needed its own way in and had a pair of buttons at the head of
      the sidebar. Two places, two vocabularies, and a `+` that quietly meant
      "query". It opens a menu of the two instead, each carrying the keystroke
      that skips the menu — which is the thing a menu is for once you have
      found it twice.
    -->
    <button
      ref="newButton"
      v-tip="t('workspace.newTab')"
      class="strip__new no-drag"
      :aria-label="t('workspace.newTab')"
      :aria-expanded="newMenuOpen"
      aria-haspopup="menu"
      @click="openNewMenu"
    >
      <AppIcon
        name="plus"
        :size="13"
      />
    </button>

    <ContextMenu
      v-model="newMenuOpen"
      :items="newMenuItems"
      :at="newMenuAt"
      @choose="onNewChoose"
    />
  </div>
</template>

<style scoped>
/*
 * The strip is a drag surface, and the tabs on it are not.
 *
 * Everything along the window's top edge that is not itself a control should
 * move the window — that is where the hand goes. The tabs opt out because they
 * are draggable in their own right, for reordering.
 *
 * No surface of its own either. The strip is a region of the top bar, not a
 * band inside the content pane, and the bar is the material — a tint here would
 * be a second shade drawn across part of one bar, which is exactly the line
 * under the window controls that the bar exists to remove.
 */
/*
 * The strip wears the working pane's surface, and is the top of it.
 *
 * The bar used to be one shade across its whole width, which made the window
 * read as two columns with a band laid over them. Continuing the pane up
 * through the bar puts the tabs on the thing they belong to.
 */
.strip {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--gap-tight);
  min-width: 0;
  height: 100%;
  /* Both ends, not just the trailing one. The first tab used to sit flush
     against the seam with the columns while the last had room to spare. */
  padding-inline: var(--gap-tight);
  /* Given up when the sidebar is collapsed — see `.topbar--alone` — and the
     change is animated so it reads as one movement with the corner. */
  transition: background-color 260ms cubic-bezier(0.32, 0.72, 0, 1);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

/*
 * The tabs themselves; the strip around them is what scrolls.
 *
 * It grows to fill the strip so the tabs inside it have a width to divide —
 * without that they would size to their content and the equal division would
 * have nothing to divide. Past the point where they hit their floor it grows
 * beyond the strip instead, and the strip scrolls.
 */
.strip__tabs {
  position: relative;
  display: flex;
  /*
   * Sized by its tabs, and never shrunk below them.
   *
   * `flex: 0 1 auto` let the strip squeeze this box when the tabs stopped
   * fitting — and the tabs, being a fixed width each, carried on painting
   * outside it. The overflow landed on top of the new-tab button, which from
   * about eleven tabs on could not be clicked at all: the thing you press to
   * get another tab stopped working exactly when you had enough tabs to need
   * it. Refusing to shrink makes the strip scroll instead, which is what the
   * overflow was always for.
   */
  flex: 0 0 auto;
  align-items: center;
  gap: var(--gap-tight);
  min-width: 0;
  height: 100%;
}

.strip::-webkit-scrollbar {
  display: none;
}

/*
 * Tonal and flush, and nothing drawn around it.
 *
 * It carried an inset hairline, on the argument that a fill alone reads as a
 * smudge against a translucent bar. The answer to that is a fill with enough
 * step in it, not a line: an outline around the open tab makes it a *box* on a
 * bar that has no other boxes, and against the quiet tabs beside it the outline
 * is the loudest thing in the strip — louder than the selection it is marking.
 * A step up the ramp says the same thing with nothing added.
 */
.strip__marker {
  position: absolute;
  top: 50%;
  left: 0;
  height: calc(var(--tab-h) - var(--gap));
  margin-top: calc((var(--tab-h) - var(--gap)) / -2);
  border-radius: var(--control-radius);
  /*
   * The working surface, come up to meet the bar.
   *
   * It was a *tint* over the bar, which in light mode makes the open tab darker
   * than the pane it belongs to — the opposite of what every browser does and
   * of what the shape means. A tab is the front edge of its page: painting it
   * the page's own colour is what makes the two read as one thing, and it lands
   * lighter than the bar in light mode and lighter than the bar in dark, which
   * is the same relationship both ways round.
   */
  background: var(--color-base-100);
  transition:
    transform var(--t-pop) var(--ease-out),
    width var(--t-pop) var(--ease-out);
}

/*
 * Arriving and leaving, both as a width and an alpha.
 *
 * An animation on `width` overrides the transition on the same property for as
 * long as it runs, which is what lets a tab grow out of nothing while its
 * neighbours are transitioning to make room — one movement, one curve. The
 * padding goes with it, or the contents of a tab a few pixels wide would spill
 * out of it, and `overflow: hidden` clips the label while there is no room for
 * it yet.
 */
.striptab--entering,
.striptab--leaving {
  overflow: hidden;
}

@keyframes tab-in {
  from {
    width: 0;
    padding-inline: 0;
    opacity: 0;
  }
}

@keyframes tab-out {
  to {
    width: 0;
    padding-inline: 0;
    opacity: 0;
  }
}

.striptab--entering {
  animation: tab-in 260ms cubic-bezier(0.32, 0.72, 0, 1);
}

.striptab--leaving {
  animation: tab-out 180ms cubic-bezier(0.32, 0.72, 0, 1) both;
  pointer-events: none;
}

/* Held, it is the same object as the tab and must not arrive after it. */
.strip__marker--held {
  transition: none;
}

@media (prefers-reduced-motion: reduce) {
  .strip__marker,
  .striptab {
    transition: none;
  }

  /* They still arrive and still leave, without the travel. */
  .striptab--entering {
    animation-name: none;
  }

  .striptab--leaving {
    animation-duration: 90ms;
  }
}

/*
 * Every tab the same width, the way a browser does it.
 *
 * They used to be as wide as their titles, which meant the strip re-laid itself
 * out whenever a title changed — running a query renames its tab — and every
 * tab moved sideways under the pointer. Worse, two tabs of the same kind could
 * be four times different in width for no reason the reader could act on.
 *
 * The number comes from `sizeTabs`, not from `flex`: see the note there for why
 * dividing the space with `flex-basis: 0` puts the new-tab button in the wrong
 * place.
 */
.striptab {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  flex: 0 0 auto;
  width: var(--tab-w, var(--tab-max));
  height: calc(var(--tab-h) - var(--gap));
  padding-inline: var(--gap) var(--gap-tight);
  border-radius: var(--control-radius);
  font-size: 0.75rem;
  color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
  touch-action: none;
  /*
   * The width is animated on the same curve and duration as the marker that
   * travels over them, so opening a tab is one movement: every tab narrows,
   * the selection slides, and they arrive together. Left instant, the row
   * snapped to its new widths and the marker then slid across a layout that had
   * already changed underneath it.
   */
  transition:
    width 260ms cubic-bezier(0.32, 0.72, 0, 1),
    background-color var(--t-hover) var(--ease-out),
    color var(--t-hover) var(--ease-out);
}

/*
 * Only the ones the marker is not already under. Hovering the open tab would
 * put a second surface over the one that says it is open, and two highlights
 * for one state only line up while nothing moves.
 */
/*
 * A closed tab is a tab, not a word on a bar.
 *
 * They were transparent until hovered, so a strip of five read as five labels
 * floating on the window material with one card among them. A fill quiet enough
 * to sit below the open one still says "these are the same kind of object" —
 * which is the whole job of the row.
 */
.striptab:not(.striptab--on) {
  background: color-mix(in oklab, var(--color-base-content) 5%, transparent);
}

.striptab:not(.striptab--on):hover {
  background: color-mix(in oklab, var(--color-base-content) 10%, transparent);
  color: var(--color-base-content);
}

.striptab--on {
  color: var(--color-base-content);
  /*
   * Weight, not size. It is the one axis that adds presence without changing
   * how much room the tab takes — and the marker is measured from that room,
   * so a tab that grew on selection would drag the marker along behind it.
   */
  font-weight: 550;
}

/*
 * Lifted only while held. This is the one moment elevation is honest: the tab
 * is genuinely off the row, following the pointer, and the shadow is what says
 * so. The marker underneath drops its transition to stay with it.
 */
.striptab--dragging {
  z-index: 2;
  background-color: var(--control-thumb);
  box-shadow: var(--elev-popover);
  transition: none;
}

.striptab__mark {
  flex: 0 0 auto;
  opacity: 0.55;
}

.striptab--on .striptab__mark {
  opacity: 0.8;
}

/*
 * The title takes the slack, so everything after it stays at the trailing edge.
 *
 * Tabs are one width now rather than the width of their titles, which left a
 * short title packed against the start and the close button sitting wherever
 * the text happened to end — in the middle of the tab, where a click meant to
 * select it closed it instead.
 */
/*
 * The field is the label: same font, same box, no border and no fill of its
 * own. A rename that draws a text input over the tab makes the tab jump at the
 * moment the pointer is on it.
 */
.striptab__rename {
  min-width: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  outline: none;
}

.striptab__title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.striptab__scope {
  flex: 0 0 auto;
  font-size: 0.625rem;
  opacity: 0.45;
}

.striptab__close {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 1.125rem;
  height: 1.125rem;
  border-radius: 0.25rem;
  color: inherit;
  opacity: 0;
  transition:
    opacity var(--t-hover) var(--ease-out),
    background-color var(--t-press) var(--ease-out);
}

/*
 * The two marks occupy the same cell and swap. An unsaved tab shows its dot
 * until the pointer is over the button, and then shows what pressing it does.
 */
.striptab__dot,
.striptab__cross {
  grid-area: 1 / 1;
}

.striptab__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
}

.striptab__close--unsaved {
  opacity: 0.75;
}

.striptab__close--unsaved .striptab__cross {
  opacity: 0;
}

.striptab:hover .striptab__close,
.striptab--on .striptab__close,
.striptab__close:focus-visible {
  opacity: 0.6;
}

.striptab__close:hover,
.striptab__close--unsaved:hover {
  opacity: 1;
  background: var(--fill-2);
}

.striptab__close:hover .striptab__dot {
  opacity: 0;
}

.striptab__close:hover .striptab__cross {
  opacity: 1;
}

/* Sized like a tab, because it sits in the same row as one. */
.strip__new {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: var(--hit-min);
  height: calc(var(--tab-h) - var(--gap));
  border-radius: var(--control-radius);
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
  transition:
    background-color var(--t-hover) var(--ease-out),
    color var(--t-hover) var(--ease-out),
    transform var(--t-press) var(--ease-out);
}

.strip__new:hover {
  background: var(--fill-4);
  color: var(--color-base-content);
}

.strip__new:active {
  transform: scale(0.92);
}
</style>
