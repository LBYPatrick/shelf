<script setup lang="ts">
/**
 * The main window once a connection is open.
 *
 * Five regions: an icon rail, a resizable sidebar, the tabbed workspace, and a
 * status bar the active tab contributes to. Chrome is translucent and the
 * content scrolls beneath it rather than beside it.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import CommandPalette from '../components/chrome/CommandPalette.vue';
import ConnectionSwitcher from '../components/sidebar/ConnectionSwitcher.vue';
import StatusBar from '../components/chrome/StatusBar.vue';
import TabStrip from '../components/chrome/TabStrip.vue';
import EntityTree from '../components/sidebar/EntityTree.vue';
import HistoryList from '../components/sidebar/HistoryList.vue';
import SavedQueryList from '../components/sidebar/SavedQueryList.vue';
import ErdTab from '../components/tabs/ErdTab.vue';
import JobList from '../components/sidebar/JobList.vue';
import JobTab from '../components/tabs/JobTab.vue';
import QueryTab from '../components/tabs/QueryTab.vue';
import TableTab from '../components/tabs/TableTab.vue';
import SettingsSheet from '../components/settings/SettingsSheet.vue';
import AppIcon from '../components/ui/AppIcon.vue';
import PressButton from '../components/ui/PressButton.vue';
import ResizeHandle from '../components/ui/ResizeHandle.vue';
import { useConnections } from '../stores/connections';
import { useEntities } from '../stores/entities';
import { useQueries } from '../stores/queries';
import { useJobs } from '../stores/jobs';
import { useTabs } from '../stores/tabs';
import { useHotkeys } from '../composables/useHotkeys';
import { vTip } from '../lib/hoverTip';
import { shortcutLabel } from '../lib/keybindings';
import { useTranslation } from 'i18next-vue';

const connections = useConnections();
const entities = useEntities();
const tabs = useTabs();
const queries = useQueries();
const jobs = useJobs();
const { t } = useTranslation();

type RailItem = 'entities' | 'queries' | 'history' | 'jobs';

const rail = ref<RailItem>('entities');
const sidebarWidth = ref(248);
const sidebarCollapsed = ref(false);
const paletteOpen = ref(false);
const settingsOpen = ref(false);

// Built as a computed so the labels follow a language change rather than
// keeping whichever language the component happened to mount in.
const railItems = computed<readonly { id: RailItem; label: string; icon: string }[]>(() => [
  { id: 'entities', label: t('workspace.entities'), icon: 'tables' },
  { id: 'queries', label: t('workspace.savedQueries'), icon: 'star' },
  { id: 'history', label: t('workspace.history'), icon: 'history' },
  { id: 'jobs', label: t('workspace.jobs'), icon: 'jobs' },
]);

/**
 * The active marker travels between rail items rather than blinking on and off,
 * which is what makes the three read as positions on one axis.
 */
const railIndex = computed(() => railItems.value.findIndex((item) => item.id === rail.value));

const nouns = computed(() => connections.active?.capabilities.nouns);
/**
 * The engine's own word for its entities, in the reader's language.
 *
 * This goes through the reactive `t` rather than i18next directly: calling
 * i18next from inside a computed gives it no dependency on the language, so the
 * word would keep whichever one it was first evaluated in.
 */
const entityNoun = computed(() => {
  const noun = nouns.value?.entity ?? 'table';
  const translated = t(`noun.${noun}`);
  return translated === `noun.${noun}` ? noun : translated;
});

function selectRail(item: RailItem): void {
  // Clicking the item that is already showing collapses the sidebar, which is
  // the fastest way to reclaim the space and put it back.
  if (rail.value === item) sidebarCollapsed.value = !sidebarCollapsed.value;
  else {
    rail.value = item;
    sidebarCollapsed.value = false;
  }
}

useHotkeys({
  'palette.open': () => (paletteOpen.value = true),
  'settings.open': () => (settingsOpen.value = true),
  'schema.refresh': () => void entities.refresh(),
  'sidebar.toggle': () => (sidebarCollapsed.value = !sidebarCollapsed.value),
  'tab.new': () => tabs.openQuery(),
  'tab.close': () => tabs.activeId && tabs.close(tabs.activeId),
  'tab.reopen': () => tabs.reopenLastClosed(),
  'tab.next': () => tabs.nextTab(1),
  'tab.previous': () => tabs.nextTab(-1),
});

let stopPersisting: (() => void) | undefined;

onMounted(async () => {
  void entities.refresh();
  // The history of what has been dispatched outlives the window that started
  // it, so it is read back before anything can add to it.
  void jobs.restore();

  const connectionId = connections.active?.id;
  if (!connectionId) return;

  // Restore first, then start saving — otherwise the empty initial state would
  // be written over the session we are about to read.
  void queries.refresh();
  await tabs.restore(connectionId);
  stopPersisting = tabs.persistTo(connectionId);
});

onBeforeUnmount(() => stopPersisting?.());
</script>

<template>
  <div class="workspace">
    <!--
      One bar across the whole window, and the traffic lights sit on it.
      
      The strip used to live inside the content pane, which put its leading edge
      at the sidebar's trailing edge — so with the sidebar open the tabs had a
      window's width less a sidebar to work with, and with it shut they ran
      under the window controls and had to be padded out of the way. Worse, the
      controls are wider than the rail and overhung the sidebar, so the seam
      between those two columns ran directly beneath them and every attempt to
      hide it moved it somewhere else. Spanning the bar removes both problems at
      once rather than managing them: the controls have one surface under them,
      the tabs get the window, and the columns below start under a clean edge.
    -->
    <header
      class="topbar mat-regular panel-sidebar drag-region"
      :style="{ paddingInlineStart: `max(var(--gap-tight), var(--controls-inset, 0px))` }"
    >
      <button
        v-tip="`${t('workspace.toggleSidebar')} — ${shortcutLabel('sidebar.toggle')}`"
        class="topbar__toggle no-drag"
        :aria-label="$t('workspace.toggleSidebar')"
        :aria-pressed="!sidebarCollapsed"
        @click="sidebarCollapsed = !sidebarCollapsed"
      >
        <AppIcon name="sidebar" />
      </button>

      <TabStrip />
    </header>

    <div class="workspace__main">
      <!--
        The corner the content pane cuts out of itself, backed by the same
        surface as the column beside it.
        
        The notch was a hole. Nothing under the content pane paints anything, so
        the arc showed the material the OS draws outside the window — raw,
        unblurred and untinted — while the sidebar an eighth of an inch away
        showed that material blurred, saturated and tinted. Two surfaces meeting
        along an eight-pixel curve is precisely where a difference reads as a
        drawn edge, which is what it looked like, worst on the dark theme where
        the tint carries most of the tone. It is invisible to a test with no
        vibrancy behind the window, which is why the invariant compares it to
        the sidebar rather than looking at it.
      -->
      <span
        class="notch mat-regular panel-sidebar"
        :style="{
          insetInlineStart: `calc(var(--rail-w) + ${sidebarCollapsed ? 0 : sidebarWidth}px)`,
        }"
        aria-hidden="true"
      />

      <nav
        class="rail mat-regular panel-recessed"
        :aria-label="$t('workspace.entities')"
      >
        <span
          v-show="!sidebarCollapsed"
          class="rail__marker"
          :style="{ transform: `translateY(${railIndex * 2.125}rem)` }"
          aria-hidden="true"
        />

        <button
          v-for="item in railItems"
          :key="item.id"
          v-tip="item.label"
          class="rail__item"
          :class="{ 'rail__item--on': rail === item.id && !sidebarCollapsed }"
          :aria-label="item.label"
          :aria-pressed="rail === item.id && !sidebarCollapsed"
          @click="selectRail(item.id)"
        >
          <AppIcon :name="item.icon" />
        </button>

        <!--
          The cog turns a quarter under the pointer. It is the one icon in the
          rail whose shape *means* something mechanical, so it is the one where
          movement reads as the object behaving rather than as decoration — and
          the target is at the bottom corner, away from everything else, so it
          benefits most from confirming that the pointer found it.
        -->
        <button
          v-tip="`${t('action.settings')} — ${shortcutLabel('settings.open')}`"
          class="rail__item rail__item--bottom rail__item--gear"
          :aria-label="$t('action.settings')"
          @click="settingsOpen = true"
        >
          <AppIcon name="settings" />
        </button>
      </nav>

      <aside
        class="sidebar mat-regular panel-sidebar"
        :class="{ 'sidebar--collapsed': sidebarCollapsed }"
        :style="{ width: sidebarCollapsed ? '0px' : `${sidebarWidth}px` }"
        :inert="sidebarCollapsed"
      >
        <ConnectionSwitcher />

        <div class="sidebar__head">
          <!--
            Not a filter box. Narrowing the tree in place could only ever show
            what was already loaded into it, and it competed with a palette that
            reaches the whole database, takes a path or a pattern, and opens
            what you pick. The affordance stays — a search field nobody can find
            is a search nobody uses — but pressing it opens that.
          -->
          <button
            v-if="rail === 'entities'"
            type="button"
            class="sidebar__search focus-fill"
            @click="paletteOpen = true"
          >
            <AppIcon
              name="search"
              :size="13"
            />
            <span class="sidebar__search-label">{{ $t('workspace.searchEntities') }}</span>
            <kbd class="sidebar__search-key">{{ shortcutLabel('palette.open') }}</kbd>
          </button>
          <!--
            Jobs have neither: the list is short, ordered by when things
            happened, and refreshed by the thing that changed it. A filter box
            over four rows is chrome pretending to be a feature.
          -->
          <span
            v-else-if="rail === 'jobs'"
            class="sidebar__title type-label"
          >{{
            $t('workspace.jobs')
          }}</span>
          <input
            v-else
            v-model="queries.filter"
            class="sidebar__filter"
            type="search"
            ::placeholder="rail === 'queries' ? $t('workspace.filterSaved') : $t('workspace.filterHistory')"
            spellcheck="false"
          >
          <PressButton
            v-if="rail !== 'jobs'"
            size="sm"
            :aria-label="$t('action.refresh')"
            :title="$t('action.refresh')"
            @click="rail === 'entities' ? entities.refresh() : queries.refresh()"
          >
            <AppIcon
              name="refresh"
              :size="13"
            />
          </PressButton>
        </div>

        <div
          v-if="rail === 'entities'"
          class="sidebar__counts type-label"
        >
          <span>{{ $t('workspace.shown', { count: entities.entities.length }) }}</span>
          <button
            class="sidebar__collapse"
            @click="entities.collapseAll()"
          >
            {{ $t('action.collapseAll') }}
          </button>
        </div>

        <EntityTree v-if="rail === 'entities'" />
        <JobList v-else-if="rail === 'jobs'" />
        <SavedQueryList v-else-if="rail === 'queries'" />
        <HistoryList v-else />
      </aside>

      <ResizeHandle
        v-model:size="sidebarWidth"
        :class="{ 'handle--hidden': sidebarCollapsed }"
        :min="180"
        :max="520"
        :aria-label="$t('workspace.entities')"
        @collapse-toggle="sidebarCollapsed = true"
      />

      <section class="content panel-content">
        <div class="content__body">
          <template
            v-for="tab in tabs.tabs"
            :key="tab.id"
          >
            <div
              v-show="tab.id === tabs.activeId"
              class="content__pane"
            >
              <TableTab
                v-if="tab.kind === 'table' && tab.entity"
                :entity="tab.entity"
                :active="tab.id === tabs.activeId"
              />
              <JobTab
                v-else-if="tab.kind === 'job' && tab.jobId"
                :job-id="tab.jobId"
                :active="tab.id === tabs.activeId"
              />
              <QueryTab
                v-else-if="tab.kind === 'query'"
                v-model:text="tab.text!"
                :tab-id="tab.id"
                :active="tab.id === tabs.activeId"
              />
              <ErdTab
                v-else-if="tab.kind === 'erd'"
                :active="tab.id === tabs.activeId"
                :scope="tab.scope ?? null"
              />
            </div>
          </template>

          <div
            v-if="tabs.tabs.length === 0"
            class="content__empty"
          >
            <p class="type-title">
              {{ $t('workspace.nothingOpen') }}
            </p>
            <p class="type-body content__hint">
              {{ $t('workspace.nothingOpenHint', { noun: entityNoun }) }}
            </p>
            <div class="content__actions">
              <PressButton
                variant="primary"
                size="sm"
                @click="tabs.openQuery()"
              >
                {{ $t('workspace.newQuery') }}
              </PressButton>
            </div>
          </div>
        </div>
      </section>
    </div>

    <StatusBar />

    <CommandPalette
      v-model="paletteOpen"
      @open-settings="settingsOpen = true"
    />
    <SettingsSheet v-model="settingsOpen" />
  </div>
</template>

<style scoped>
.workspace {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/*
 * At least as tall as the window controls, whatever the density scale says.
 * They are drawn by the OS and do not shrink with the interface, so a compact
 * density would otherwise crop them.
 */
.topbar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--gap-tight);
  height: max(var(--tab-h), var(--controls-h, 0px));
  padding-inline-end: var(--gap-tight);
}

.topbar__toggle {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: var(--hit-min);
  height: var(--hit-min);
  border-radius: var(--control-radius);
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
  transition:
    color var(--t-hover) var(--ease-out),
    background-color var(--t-hover) var(--ease-out),
    transform var(--t-press) var(--ease-out);
}

.topbar__toggle:hover {
  background: var(--fill-3);
  color: var(--color-base-content);
}

.topbar__toggle:active {
  transform: scale(0.92);
}

/* Pressed means the sidebar is showing — the same tonal "this mode is on" the
   tab toolbars use, rather than a second kind of selected state. */
.topbar__toggle[aria-pressed='true'] {
  color: var(--color-base-content);
}

.workspace__main {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
}

/*
 * Exactly the corner, and no more: the rest of it is under the opaque pane and
 * never seen. Travels with the sidebar on the same curve, so the collapse does
 * not leave it behind.
 */
/*
 * Behind the pane, said explicitly. A positioned element paints above an
 * in-flow one whatever the source order, so the notch was drawn *over* the
 * content rather than under its cut corner — a tinted square sitting on the
 * grid instead of a surface showing through it.
 */
.notch {
  position: absolute;
  z-index: 0;
  top: 0;
  width: var(--radius-box);
  height: var(--radius-box);
  pointer-events: none;
  /*
   * Only the wedge, never the disc.
   *
   * It was a full square sitting behind the pane's cut corner, and the pane is
   * glass — so across the quarter-disc the two surfaces stacked and composited
   * to a shade darker than either, which read as a small dark rectangle pinned
   * to the corner. Masking the disc away leaves the notch filling exactly the
   * area the clip removed and nothing else. The half-pixel of overlap is
   * deliberate: the mask and the pane's `clip-path` antialias independently,
   * and a gap between them shows the window's backdrop as a bright hairline
   * along the arc, which is the defect this element exists to prevent.
   */
  --notch-cut: calc(100% - 0.5px);
  -webkit-mask-image: radial-gradient(
    circle var(--radius-box) at 100% 100%,
    transparent 0 var(--notch-cut),
    #000 var(--notch-cut)
  );
  mask-image: radial-gradient(
    circle var(--radius-box) at 100% 100%,
    transparent 0 var(--notch-cut),
    #000 var(--notch-cut)
  );
  transition: inset-inline-start 260ms cubic-bezier(0.32, 0.72, 0, 1);
}

@media (prefers-reduced-motion: reduce) {
  .notch {
    transition: none;
  }
}

.rail {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  gap: var(--gap-hair);
  width: var(--rail-w);
  /*
   * Clears the traffic lights, then centres the first icon in the same band the
   * connection row beside it occupies. The two used to be positioned
   * independently and landed four pixels apart — close enough to look like a
   * mistake rather than a choice, which is exactly how it read.
   */
  /* One source for where the column's contents begin, so the travelling
     marker cannot end up on a different line from the icons it marks. */
  --rail-content-top: calc(var(--gap-tight) + (var(--header-h) - var(--rail-item)) / 2);
  padding-top: var(--rail-content-top);
  /*
   * No banding. The window controls are wider than this column and overhang the
   * sidebar, so a strong shade difference here draws an edge straight through
   * them — but giving the top a *different* shade to hide that only traded a
   * vertical seam for a horizontal one, which then cut across the rail directly
   * above the first icon.
   *
   * So the rail and the sidebar are near-neighbours in tone instead: enough of
   * a step to read as a separate column, too little to draw a line under the
   * traffic lights. The recession that matters is between the glass columns and
   * the opaque content pane beside them.
   *
   * The background itself comes from `panel-recessed` in `materials.css`. It
   * was restated here as well, which is how a scoped rule ended up outranking
   * the material system it was only meant to agree with.
   */
}

/*
 * No divider. The rail, the sidebar and the content pane already differ in
 * tone, and a line between two surfaces that are visibly different is a third
 * value competing with both — on the dark theme it was the brightest thing in
 * the window, brighter than either panel it separated. Surfaces that differ
 * separate themselves; a hairline is for surfaces that do not.
 */

/* One marker for all three, moved rather than redrawn. */
.rail__marker {
  position: absolute;
  top: var(--rail-content-top);
  left: 50%;
  /* Matches the item exactly; a marker even a pixel larger reads as a stray
     highlight sitting behind the icon rather than as the icon being selected. */
  margin-left: calc(var(--rail-item) / -2);
  width: var(--rail-item);
  height: var(--rail-item);
  border-radius: 0.6rem;
  /*
   * The marker is the whole indicator. The selected item used to paint its own
   * surface as well, so there were two highlights for one selection — which is
   * only invisible for as long as they line up exactly, and they did not.
   */
  background: color-mix(in oklab, var(--color-primary) 16%, transparent);
  transition: transform var(--t-pop) var(--ease-out);
}

.rail__item {
  position: relative;
  display: grid;
  place-items: center;
  width: var(--rail-item);
  height: var(--rail-item);
  border-radius: 0.6rem;
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
  transition:
    color var(--t-hover) var(--ease-out),
    transform var(--t-press) var(--ease-out);
}

.rail__item:active {
  transform: scale(0.92);
}

.rail__item:hover {
  background: var(--fill-3);
  color: var(--color-base-content);
}

.rail__item--bottom {
  margin-top: auto;
  /* Above the status bar rather than tucked into the window's corner. */
  margin-bottom: var(--gap);
}

.rail__item--gear :deep(.icon) {
  transition: transform 380ms var(--ease-out);
}

@media (hover: hover) and (pointer: fine) {
  .rail__item--gear:hover :deep(.icon) {
    transform: rotate(90deg);
  }
}

/*
 * A quarter turn is movement for its own sake, which is exactly what someone
 * who has asked for less of it does not want.
 */
@media (prefers-reduced-motion: reduce) {
  .rail__item--gear :deep(.icon) {
    transition: none;
  }

  .rail__item--gear:hover :deep(.icon) {
    transform: none;
  }
}

.rail__item--on {
  /* The marker behind it supplies the surface. */
  color: var(--color-primary-text, var(--color-primary));
}

.sidebar {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  /*
   * Collapsing animates the width rather than removing the panel, so the
   * content beside it slides over instead of jumping. The panel is `inert`
   * while collapsed: a zero-width column is still in the tab order otherwise,
   * and tabbing into something invisible is worse than it not being there.
   *
   * `overflow: hidden` is what stops the contents spilling across the
   * workspace during the travel — at 0 width they are still laid out.
   */
  overflow: hidden;
  transition: width 260ms cubic-bezier(0.32, 0.72, 0, 1);
}

.sidebar--collapsed {
  /* The divider would otherwise sit on the workspace edge as a stray hairline. */
  border: none;
}

.sidebar--collapsed::after {
  display: none;
}

@media (prefers-reduced-motion: reduce) {
  .sidebar {
    transition: none;
  }
}

/* The handle stays mounted so it fades with the panel rather than vanishing a
   frame before it, and is taken out of reach while there is nothing to size. */
.handle--hidden {
  opacity: 0;
  pointer-events: none;
}

/*
 * The sidebar's own rows sit on the same rhythm as the tree beneath them. Two
 * different vertical scales in one column is what made the head, the counts and
 * the first rows read as three unrelated strips.
 */
.sidebar__head {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--gap-tight);
  padding: var(--gap) var(--gap-tight) var(--gap) var(--gap);
}

/*
 * Shaped like the field it replaced, because it stands where one stood and does
 * what one would have done. A button that looks like a button here would read
 * as an action on the sidebar rather than a way into it.
 */
.sidebar__search {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--gap-tight);
  min-width: 0;
  height: var(--field-h);
  padding-inline: var(--gap) var(--gap-tight);
  border-radius: var(--control-radius);
  background-color: var(--fill-4);
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
  font-size: 0.8125rem;
  transition: background-color var(--t-hover) var(--ease-out);
}

.sidebar__search-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: start;
}

.sidebar__search-key {
  flex: 0 0 auto;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--fill-3);
  font-family: var(--font-ui);
  font-size: 0.625rem;
}

@media (hover: hover) and (pointer: fine) {
  .sidebar__search:hover {
    background-color: var(--fill-3);
    color: var(--color-base-content);
  }
}

/* A name where the filter would be, so the head keeps its height. */
.sidebar__title {
  flex: 1;
  padding-inline-start: var(--gap-tight);
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.sidebar__filter {
  flex: 1;
  min-width: 0;
  height: var(--field-h);
  padding-inline: var(--gap);
  border-radius: var(--radius-field);
  border: 1px solid transparent;
  background: var(--fill-4);
  color: var(--color-base-content);
  font-size: 0.75rem;
}

.sidebar__filter:focus {
  border-color: var(--color-primary);
  background: var(--color-base-100);
}

.sidebar__counts {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  height: var(--sidebar-row-h);
  gap: var(--gap);
  padding: 0 var(--gap);
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
}

.sidebar__collapse {
  display: flex;
  align-items: center;
  margin-inline-start: auto;
  /* The row is only as tall as the text; the target fills it. */
  height: 100%;
  padding-inline: var(--gap-tight);
  color: inherit;
}

.sidebar__collapse:hover {
  color: var(--color-primary-text, var(--color-primary));
}

.sidebar__todo {
  padding: var(--gap-loose);
  color: color-mix(in oklab, var(--color-base-content) 42%, transparent);
}

/*
 * One rounded corner, where the opaque pane meets the two glass edges.
 *
 * The other three are the window's own. This one had nothing to soften it and
 * the pane butted into the bar above and the column beside it as a hard right
 * angle, which read as the content being clipped by the chrome rather than
 * sitting in front of it. The glass shows through the notch, which is the
 * whole point — it is the only place the depth between the two is visible.
 */
.content {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-start-start-radius: var(--radius-box);
  /* The grid and the editor both paint to their own edges. */
  overflow: hidden;
  /*
   * The clip is a path, not the rounded overflow above it.
   *
   * Chromium does not apply an ancestor's rounded overflow clip to a descendant
   * that has been promoted to its own compositing layer — the clip degrades to
   * a rectangle. Monaco promotes itself, so the corner was cut on a table tab
   * and square on a query tab, with a white wedge in it where the pane's own
   * rounded background showed behind the editor painting straight over it. A
   * clip path is applied as a mask and reaches the composited layer.
   */
  clip-path: inset(0 round var(--radius-box) 0 0 0);
}

.content__body {
  position: relative;
  flex: 1;
  min-height: 0;
}

.content__pane {
  position: absolute;
  inset: 0;
}

.content__todo,
.content__empty {
  display: grid;
  place-content: center;
  justify-items: center;
  gap: var(--gap-tight);
  height: 100%;
  text-align: center;
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
}

.content__actions {
  display: flex;
  gap: var(--gap);
}

.content__hint {
  max-width: 22rem;
}
</style>
