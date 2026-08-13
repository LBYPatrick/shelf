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
import QueryTab from '../components/tabs/QueryTab.vue';
import StructureTab from '../components/tabs/StructureTab.vue';
import TableTab from '../components/tabs/TableTab.vue';
import SettingsSheet from '../components/settings/SettingsSheet.vue';
import AppIcon from '../components/ui/AppIcon.vue';
import PressButton from '../components/ui/PressButton.vue';
import ResizeHandle from '../components/ui/ResizeHandle.vue';
import { useConnections } from '../stores/connections';
import { useEntities } from '../stores/entities';
import { useQueries } from '../stores/queries';
import { useTabs } from '../stores/tabs';
import { useHotkeys } from '../composables/useHotkeys';
import { useTranslation } from 'i18next-vue';

const connections = useConnections();
const entities = useEntities();
const tabs = useTabs();
const queries = useQueries();
const { t } = useTranslation();

type RailItem = 'entities' | 'queries' | 'history';

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
    <div class="workspace__main">
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
          class="rail__item"
          :class="{ 'rail__item--on': rail === item.id && !sidebarCollapsed }"
          :aria-label="item.label"
          :aria-pressed="rail === item.id && !sidebarCollapsed"
          :title="item.label"
          @click="selectRail(item.id)"
        >
          <AppIcon :name="item.icon" />
        </button>

        <button
          class="rail__item rail__item--bottom"
          :aria-label="$t('action.settings')"
          :title="$t('action.settings')"
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
          <input
            v-if="rail === 'entities'"
            v-model="entities.filter"
            class="sidebar__filter"
            type="search"
            :placeholder="$t('workspace.filterEntities', { noun: entityNoun })"
            spellcheck="false"
          >
          <input
            v-else
            v-model="queries.filter"
            class="sidebar__filter"
            type="search"
            ::placeholder="rail === 'queries' ? $t('workspace.filterSaved') : $t('workspace.filterHistory')"
            spellcheck="false"
          >
          <PressButton
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
          <span>{{ $t('workspace.shown', { count: entities.visibleEntities.length }) }}</span>
          <span v-if="entities.hiddenCount > 0">{{
            $t('workspace.hidden', { count: entities.hiddenCount })
          }}</span>
          <button
            class="sidebar__collapse"
            @click="entities.collapseAll()"
          >
            {{ $t('action.collapseAll') }}
          </button>
        </div>

        <EntityTree v-if="rail === 'entities'" />
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
        <TabStrip />

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
              <QueryTab
                v-else-if="tab.kind === 'query'"
                v-model:text="tab.text!"
                :tab-id="tab.id"
                :active="tab.id === tabs.activeId"
              />
              <StructureTab
                v-else-if="tab.kind === 'structure' && tab.entity"
                :entity="tab.entity"
                :active="tab.id === tabs.activeId"
              />
              <ErdTab
                v-else-if="tab.kind === 'erd'"
                :active="tab.id === tabs.activeId"
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
              <PressButton
                v-if="connections.active?.capabilities.relations"
                variant="glass"
                size="sm"
                @click="tabs.openErd()"
              >
                {{ $t('workspace.diagram') }}
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

.workspace__main {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.rail {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  gap: var(--gap-hair);
  width: var(--rail-w);
  /* Clears the traffic lights, which float over this column on macOS. */
  padding-top: var(--rail-top, var(--gap-tight));
  /*
   * The window controls are wider than this column, so they overhang into the
   * sidebar. Painting the rail's own darker shade all the way up puts a hard
   * vertical edge straight through them — half of each control on one surface,
   * half on another. One gradient with a hard stop gives the strip the
   * sidebar's shade and the rest the rail's, without stacking a second
   * translucent layer to do it.
   */
  background-color: transparent;
  background-image: linear-gradient(
    to bottom,
    var(--panel-strip) 0 var(--rail-top, 0px),
    var(--mat-bg) var(--rail-top, 0px)
  );
}

/*
 * The divider starts below the window controls. A full-height border would run
 * straight through them, which reads as the chrome being drawn over the OS.
 */
.rail::after {
  content: '';
  position: absolute;
  inset-block: var(--rail-top, var(--gap-tight)) 0;
  inset-inline-end: 0;
  width: 1px;
  background: color-mix(in oklab, var(--color-base-content) 8%, transparent);
}

/* One marker for all three, moved rather than redrawn. */
.rail__marker {
  position: absolute;
  top: var(--rail-top, var(--gap-tight));
  left: 50%;
  /* Matches the item exactly; a marker even a pixel larger reads as a stray
     highlight sitting behind the icon rather than as the icon being selected. */
  margin-left: -1rem;
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
  background: color-mix(in oklab, var(--color-base-content) 9%, transparent);
  transition: transform var(--t-pop) var(--ease-out);
}

.rail__item {
  position: relative;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
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
  background: color-mix(in oklab, var(--color-base-content) 8%, transparent);
  color: var(--color-base-content);
}

.rail__item--bottom {
  margin-top: auto;
  /* Above the status bar rather than tucked into the window's corner. */
  margin-bottom: var(--gap);
}

.rail__item--on {
  background: color-mix(in oklab, var(--color-primary) 18%, transparent);
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

.sidebar::after {
  content: '';
  position: absolute;
  inset-block: var(--rail-top, var(--gap-tight)) 0;
  inset-inline-end: 0;
  width: 1px;
  background: color-mix(in oklab, var(--color-base-content) 8%, transparent);
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

.sidebar__filter {
  flex: 1;
  min-width: 0;
  height: var(--field-h);
  padding-inline: var(--gap);
  border-radius: var(--radius-field);
  border: 1px solid transparent;
  background: color-mix(in oklab, var(--color-base-content) 6%, transparent);
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

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
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
