<script setup lang="ts">
/**
 * The main window once a connection is open.
 *
 * Five regions: an icon rail, a resizable sidebar, the tabbed workspace, and a
 * status bar the active tab contributes to. Chrome is translucent and the
 * content scrolls beneath it rather than beside it.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import CommandPalette from '../components/chrome/CommandPalette.vue';
import ConnectionSwitcher from '../components/sidebar/ConnectionSwitcher.vue';
import StatusBar from '../components/chrome/StatusBar.vue';
import TabStrip from '../components/chrome/TabStrip.vue';
import ChatList from '../components/sidebar/ChatList.vue';
import EntityTree from '../components/sidebar/EntityTree.vue';
import HistoryList from '../components/sidebar/HistoryList.vue';
import SavedQueryList from '../components/sidebar/SavedQueryList.vue';
import ChatTab from '../components/assistant/ChatTab.vue';
import EngineMark from '../components/connection/EngineMark.vue';
import CliSignInSheet from '../components/assistant/CliSignInSheet.vue';
import StorageSheet from '../components/settings/StorageSheet.vue';
import ProviderSheet from '../components/assistant/ProviderSheet.vue';
import ErdTab from '../components/tabs/ErdTab.vue';
import JobList from '../components/sidebar/JobList.vue';
import JobTab from '../components/tabs/JobTab.vue';
import QueryTab from '../components/tabs/QueryTab.vue';
import TableTab from '../components/tabs/TableTab.vue';
import SettingsSheet from '../components/settings/SettingsSheet.vue';
import ShortcutSheet from '../components/settings/ShortcutSheet.vue';
import DiagnoseSheet from '../components/sidebar/DiagnoseSheet.vue';
import ConnectionEditor from '../components/connection/ConnectionEditor.vue';
import AppIcon from '../components/ui/AppIcon.vue';
import PressButton from '../components/ui/PressButton.vue';
import ResizeHandle from '../components/ui/ResizeHandle.vue';
import { useAssistant } from '../stores/assistant';
import { useConnections } from '../stores/connections';
import { useEntities } from '../stores/entities';
import { useQueries } from '../stores/queries';
import { useJobs } from '../stores/jobs';
import { useTabs } from '../stores/tabs';
import { useHotkeys } from '../composables/useHotkeys';
import { vTip } from '../lib/hoverTip';
import { engineDescriptor } from '@shared/engines';
import type { AiDriverKind } from '@shared/ai';
import type { SavedConnection } from '@shared/connections';
import { shortcutLabel } from '../lib/keybindings';
import { useTranslation } from 'i18next-vue';

const assistant = useAssistant();
const connections = useConnections();
const entities = useEntities();
const tabs = useTabs();

/**
 * A tab that has just been opened, and is still arriving.
 *
 * A new tab used to be *there* — the whole apparatus of an editor, a divider,
 * two toolbars and an empty grid, painted complete in one frame, which reads as
 * a jump cut rather than as something opening. So the pane's regions arrive in
 * order, top to bottom, over about a third of a second.
 *
 * Held per tab id rather than run on every mount, because the pane is kept in
 * the tree while its tab is in the background: a CSS animation on a box that
 * goes `display: none` and back restarts each time, which would replay the
 * whole cascade on every switch between two tabs. This runs when the tab is
 * *new*, which is the thing being animated.
 */
const opening = ref(new Set<string>());
const OPENING_MS = 700;

watch(
  () => tabs.tabs.map((tab) => tab.id),
  (ids, before) => {
    const had = new Set(before ?? []);
    for (const id of ids) {
      if (had.has(id)) continue;
      opening.value.add(id);
      // A `Set` mutated in place is reactive in Vue 3, but the timer has to
      // trigger the render itself.
      setTimeout(() => {
        opening.value.delete(id);
        opening.value = new Set(opening.value);
      }, OPENING_MS);
    }
    opening.value = new Set(opening.value);
  }
);
const queries = useQueries();
const jobs = useJobs();
const { t } = useTranslation();

type RailItem = 'entities' | 'queries' | 'history' | 'jobs' | 'chats';

const rail = ref<RailItem>('entities');
/**
 * The width the sidebar is put back to.
 *
 * Named because three things now say it: the initial value, the double click on
 * the divider, and the palette's row. A number typed three times is a number
 * that gets changed twice.
 */
const SIDEBAR_W = 248;

/*
 * Below this the entities row drops its count.
 *
 * The row is a count and three controls, and at the column's 180px minimum
 * those want about 210. Measured against `sidebarWidth` rather than through a
 * container query, because `container-type: inline-size` would have to go on
 * the sidebar — which holds a virtualised list that computes its own scroll
 * height — and the width is already a number this view owns.
 */
const COUNT_MIN_W = 220;

const sidebarWidth = ref(SIDEBAR_W);
const sidebarCollapsed = ref(false);

/*
 * Put back, and shown while it is at it: a reset that happens behind a
 * collapsed sidebar is a command that appears to have done nothing.
 */
function resetSidebarWidth(): void {
  sidebarWidth.value = SIDEBAR_W;
  sidebarCollapsed.value = false;
}
const paletteOpen = ref(false);
const settingsOpen = ref(false);
const providersOpen = ref(false);
const shortcutsOpen = ref(false);
const storageOpen = ref(false);
const diagnoseOpen = ref(false);

/*
 * The sheet that says how to sign a command-line assistant in.
 *
 * Two pieces of state rather than one, because the sheet is closed by setting
 * the boolean and the kind has to survive the closing animation — clearing it
 * on the same tick empties the sheet while it is still on screen.
 */
const signInOpen = ref(false);
const signInKind = ref<AiDriverKind | null>(null);

function askToSignIn(kind: AiDriverKind): void {
  signInKind.value = kind;
  signInOpen.value = true;
}

/**
 * The connection editor, over the workspace.
 *
 * `null` is the editor's word for "a new one" and `undefined` is closed, which
 * is why this is not a boolean. Saving a connection should not cost you the one
 * you are in, so it opens here rather than sending you back to the start screen
 * to do it.
 */
const editingConnection = ref<SavedConnection | null | undefined>(undefined);

function onConnectionSaved(connection: SavedConnection, connectNow: boolean): void {
  editingConnection.value = undefined;
  if (connectNow) void connections.connect(connection);
}

const engineHue = computed(() =>
  connections.active ? engineDescriptor(connections.active.engine).hue : 250
);

/** The ways in, in the order they are worth offering. */
const openings = computed(() => [
  {
    id: 'query',
    icon: 'query',
    label: t('workspace.newQuery'),
    hint: shortcutLabel('tab.new'),
    run: () => tabs.openQuery(),
  },
  {
    id: 'chat',
    icon: 'assistant',
    label: t('assistant.newChat'),
    hint: shortcutLabel('assistant.open'),
    run: () => tabs.openChat(),
  },
  {
    id: 'find',
    icon: 'search',
    /*
     * Its own words, not the sidebar's. The field above the tree is labelled
     * "Search tables", and a row here carrying the same name would be a second
     * control with one name — which the interface cannot tell apart either, and
     * said so in the test suite.
     */
    label: t('workspace.findAnything'),
    hint: shortcutLabel('palette.open'),
    run: () => (paletteOpen.value = true),
  },
]);

const railItems = computed<readonly { id: RailItem; label: string; icon: string }[]>(() => [
  { id: 'entities', label: t('workspace.entities'), icon: 'tables' },
  { id: 'queries', label: t('workspace.savedQueries'), icon: 'star' },
  { id: 'history', label: t('workspace.history'), icon: 'history' },
  { id: 'jobs', label: t('workspace.jobs'), icon: 'jobs' },
  { id: 'chats', label: t('chats.title'), icon: 'assistant' },
]);

/**
 * The active marker travels between rail items rather than blinking on and off,
 * which is what makes the three read as positions on one axis.
 */
const railIndex = computed(() => railItems.value.findIndex((item) => item.id === rail.value));

/**
 * A rail item shows its panel. It never hides one.
 *
 * Pressing the item already showing used to collapse the sidebar, which reads
 * as a shortcut and behaves as a trap: the five items are a set of
 * *destinations*, and one of them being a toggle means the same gesture on the
 * same-looking button does two opposite things depending on where you already
 * were. Aiming at the panel you are on — to bring it back to the front, or
 * because you misremembered which was open — closed the column instead.
 *
 * So the answer to any of the five is the same answer: show that panel, and
 * open the column if it is shut. That makes the collapsed rail useful rather
 * than inert — a press goes straight to the panel you wanted instead of opening
 * whichever one happened to be last.
 *
 * Collapsing has its own control, directly below these and in the same column,
 * plus its shortcut. One button, one job.
 */
function selectRail(item: RailItem): void {
  rail.value = item;
  sidebarCollapsed.value = false;
}

useHotkeys({
  'palette.open': () => (paletteOpen.value = true),
  'settings.open': () => (settingsOpen.value = true),
  'schema.refresh': () => void entities.refresh(),
  'sidebar.toggle': () => (sidebarCollapsed.value = !sidebarCollapsed.value),
  'tab.new': () => tabs.openQuery(),
  'assistant.open': () => tabs.openChat(),
  'tab.close': () => tabs.activeId && tabs.close(tabs.activeId),
  'tab.reopen': () => tabs.reopenLastClosed(),
  'tab.next': () => tabs.nextTab(1),
  'tab.previous': () => tabs.nextTab(-1),
});

let stopPersisting: (() => void) | undefined;

onMounted(async () => {
  // The provider list is read once per window: every chat tab and every Ask
  // sheet reads the same store rather than each asking main for the list.
  const providers = assistant.refresh();

  /*
   * The tree first, then the assistant's read of the same database.
   *
   * Both walk the schema and both go down one connection, so starting them
   * together would queue a couple of hundred speculative round trips in front
   * of the list the reader is sitting and watching. Held until after, the panel
   * fills at the speed it always did and the warm-up gets the connection while
   * nobody is waiting on it.
   *
   * It waits on the provider list as well, and has to: the warm-up declines to
   * run where no assistant is configured, and that list arrives from main a
   * moment after this starts. Read too early it is always empty, and the
   * warm-up would decline every time for a reason that was about to stop being
   * true.
   */
  void Promise.all([entities.refresh(), providers])
    .catch(() => undefined)
    .then(() => assistant.warmSchema(connections.active?.id));
  void assistant.refreshChats(connections.active?.id ?? null);
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

/*
 * A connection swapped under the workspace is a different database.
 *
 * The window is not rebuilt for one, so `onMounted` has already been and gone;
 * without this the assistant would arrive at the new database cold, which is
 * the case the warm-up exists for.
 */
watch(
  () => connections.active?.id,
  (id, before) => {
    if (!id || id === before) return;
    void entities
      .refresh()
      .catch(() => undefined)
      .then(() => assistant.warmSchema(id));
  }
);

onBeforeUnmount(() => stopPersisting?.());
</script>

<template>
  <div
    class="workspace"
    :style="{ '--sidebar-w': sidebarCollapsed ? '0px' : `${sidebarWidth}px` }"
  >
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
    <header class="topbar drag-region">
      <!--
        The controls, the toggle, and the room the columns take up.
        ──────────────────────────────────────────────────────────
        The tabs used to begin immediately after the toggle, which put the first
        tab's leading edge at an offset that matched nothing — a vertical line a
        hundred pixels from the left, with the rail/sidebar boundary at forty
        and the pane's edge at three hundred. Every other edge in this window
        lines up with one of those two.

        So this region *is* the columns' width, and the strip starts where the
        working pane starts. `min-width` rather than `width`, because collapsing
        the sidebar takes that offset down to the rail alone — which is narrower
        than the traffic lights and the toggle beside them — and a tab strip
        sliding under the window controls is the one thing this bar exists to
        prevent. It travels on the sidebar's own curve, so the two move as one
        thing rather than as two that happen to agree at each end.
      -->
      <div class="topbar__lead mat-regular panel-sidebar" />

      <TabStrip :tight="sidebarCollapsed" />
    </header>

    <div class="workspace__main">
      <!--
        The left panel is one column, and the database is at the top of it.
        ─────────────────────────────────────────────────────────────────
        The rail used to run the full height *beside* the connection tile,
        which said the two were peers — a strip of destinations on one side and
        a database on the other. They are not peers. The connection is what
        every one of those destinations is *about*: the tables are its tables,
        the history is what was run against it, the chats are conversations
        about it. So it sits over all of them, and the rail and the panel it
        switches are the two halves of what is underneath.
      -->
      <div
        class="leftpanel mat-regular panel-sidebar"
        :class="{ 'leftpanel--tight': sidebarCollapsed }"
      >
        <ConnectionSwitcher
          @diagnose="diagnoseOpen = true"
          @new-connection="editingConnection = null"
        />

        <div class="leftpanel__body">
          <nav class="rail" :aria-label="$t('workspace.entities')">
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
          The sidebar's own switch, in the sidebar's own column.
          ─────────────────────────────────────────────────────
          It sat on the top bar beside the traffic lights, where it was the one
          control in that row that acted on something *below* the row — and it
          pushed the tab strip along to an offset that lined up with nothing.
          Here it is at the foot of the column it opens and shuts, under the
          five things that column can show, which is where a control belongs
          when it governs the thing beside it.

          Above the cog rather than below it, because the cog is the last thing
          in the window: everything else in this column is about the database,
          and settings is about the app.
        -->
            <button
              v-tip="`${t('workspace.toggleSidebar')} — ${shortcutLabel('sidebar.toggle')}`"
              class="rail__item rail__item--bottom"
              :aria-label="$t('workspace.toggleSidebar')"
              :aria-pressed="!sidebarCollapsed"
              @click="sidebarCollapsed = !sidebarCollapsed"
            >
              <AppIcon name="sidebar" />
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
              class="rail__item rail__item--gear"
              :aria-label="$t('action.settings')"
              @click="settingsOpen = true"
            >
              <AppIcon name="settings" />
            </button>
          </nav>

          <aside
            class="sidebar"
            :class="{ 'sidebar--collapsed': sidebarCollapsed }"
            :inert="sidebarCollapsed"
          >
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
                <AppIcon name="search" :size="13" />
                <span class="sidebar__search-label">{{ $t('workspace.searchEntities') }}</span>
                <kbd class="sidebar__search-key">{{ shortcutLabel('palette.open') }}</kbd>
              </button>
              <!--
            Jobs have a field of their own.
            ───────────────────────────────
            There used to be a name here instead, on the argument that the list
            is short and ordered by when things happened. It stops being short:
            a hundred are kept, they are named after the database and the minute
            by default, and the one worth finding is rarely the newest. The
            field searches the names; the button beside it opens the four
            questions a log gets asked that a name cannot answer.
          -->
              <!--
            Chats search from the same row every other panel searches from.
            ───────────────────────────────────────────────────────────────
            The field used to sit inside the list, which left this row holding
            nothing but a `+` floating against the right edge — a band of empty
            sidebar above the panel, and a button with no row to belong to. Two
            search fields in two places for five panels is two things to learn
            where there was one.
          -->
              <label v-else-if="rail === 'chats' || rail === 'jobs'" class="sidebar__find">
                <AppIcon class="sidebar__find-icon" name="search" :size="13" />
                <input
                  v-if="rail === 'chats'"
                  v-model="assistant.filter.text"
                  class="sidebar__find-input"
                  type="search"
                  :placeholder="$t('chats.find')"
                  :aria-label="$t('chats.find')"
                  spellcheck="false"
                />
                <input
                  v-else
                  v-model="jobs.filter.text"
                  class="sidebar__find-input"
                  type="search"
                  :placeholder="$t('jobs.find')"
                  :aria-label="$t('jobs.find')"
                  spellcheck="false"
                />
              </label>
              <!--
            A field, with the glyph that says what it is.
            ─────────────────────────────────────────────
            It had none of that: `::placeholder` — two colons — is not a binding
            Vue can act on, so it silently bound nothing and the field rendered
            as an empty black box with no word in it and no icon beside it. The
            one thing a search field has to do before it is used is look like
            one.
          -->
              <label v-else class="sidebar__find">
                <AppIcon class="sidebar__find-icon" name="search" :size="13" />
                <input
                  v-model="queries.filter"
                  class="sidebar__find-input"
                  type="search"
                  :placeholder="
                    rail === 'queries'
                      ? $t('workspace.filterSaved')
                      : $t('workspace.filterHistory')
                  "
                  :aria-label="
                    rail === 'queries'
                      ? $t('workspace.filterSaved')
                      : $t('workspace.filterHistory')
                  "
                  spellcheck="false"
                />
              </label>
              <!--
            One action per panel, and the one that panel actually has.
            ─────────────────────────────────────────────────────────
            This slot used to mean "refresh" on four panels and "new chat" on
            the fifth — the same position doing two unrelated jobs — and on
            three of the four there was nothing to refresh: the history and the
            jobs are logs this window writes itself, and refreshing a log you
            just wrote is a button that cannot do anything.

            "New chat" is gone from here entirely. It is one of the two primary
            actions at the head of the sidebar now, and a second copy of it in
            the panel below said the two were different things.
          -->
              <PressButton
                v-if="rail === 'entities' || rail === 'queries'"
                v-tip="$t('action.refresh')"
                size="sm"
                :aria-label="$t('action.refresh')"
                @click="rail === 'entities' ? entities.refresh() : queries.refresh()"
              >
                <AppIcon name="refresh" :size="13" />
              </PressButton>
              <PressButton
                v-else-if="rail === 'history'"
                v-tip="$t('history.clear')"
                size="sm"
                :aria-label="$t('history.clear')"
                @click="queries.clearHistory()"
              >
                <AppIcon name="trash" :size="13" />
              </PressButton>
            </div>

            <!--
            What the tree is showing, and the three things you can do about it.
            ──────────────────────────────────────────────────────────────────
            One row, and the controls in it are one shape.

            It was two rows: this one, and a settings row under it holding the
            word "Built-ins" and a switch. Two rows of chrome above a tree is a
            lot of chrome, and the switch was the wrong control for the place —
            a labelled switch is what a settings sheet is made of, and putting
            one in a status strip made the strip read as a fragment of a form.
            A count, a label, a switch and two buttons also want about 210px in
            a column that goes down to 180.

            So the mode joins the two actions in the row, and *loudness* carries
            the difference — the rule the tab toolbars already follow. Quiet is
            off, a tonal accent surface is on.

            It says its name. As an icon alone it was not obvious enough: an eye
            is a legible verb once you know what it acts on, and nothing in a
            28px tile says what that is. The eye stays beside the word, because a
            quiet chip of text with no mark on it is what "Collapse all" used to
            be here — a label until you hover it. And it is struck through while
            the built-ins are hidden, so the state is readable from the mark as
            well as from the surface. That needed `eyeOff` redrawn: the
            broken-eye form every icon set ships is five subpaths and is a
            scribble at 13px.

            The count is what yields when the column is dragged narrow. It is the
            row's least important part — the database's own row repeats it — and
            the three controls are what have to stay reachable, so it goes rather
            than the row wrapping or a chip losing its word.

            Each fold is disabled at its own extreme, so the pair also says how
            far open the tree is: both live means part open. Dimmed rather than
            hidden, because a control that vanishes changes the width of the row
            as you use it.
          -->
            <div v-if="rail === 'entities'" class="sidebar__counts type-label">
              <span v-if="sidebarWidth >= COUNT_MIN_W" class="sidebar__count">{{
                $t('workspace.shown', { count: entities.visibleEntities.length })
              }}</span>
              <div class="sidebar__tools">
                <button
                  v-if="connections.active?.capabilities.builtInEntities"
                  v-tip="$t('workspace.builtInsHelp')"
                  type="button"
                  class="sidebar__tool sidebar__tool--named sidebar__tool--mode"
                  :class="{ 'sidebar__tool--on': entities.showBuiltIns }"
                  role="switch"
                  :aria-checked="entities.showBuiltIns"
                  :aria-label="$t('workspace.builtInsHelp')"
                  @click="entities.showBuiltIns = !entities.showBuiltIns"
                >
                  <AppIcon :name="entities.showBuiltIns ? 'eye' : 'eyeOff'" :size="13" />
                  <span>{{ $t('workspace.builtIns') }}</span>
                </button>
                <button
                  v-tip="$t('action.collapseAll')"
                  type="button"
                  class="sidebar__tool sidebar__tool--in"
                  :disabled="entities.allCollapsed"
                  :aria-label="$t('action.collapseAll')"
                  @click="entities.collapseAll()"
                >
                  <AppIcon name="arrowsIn" :size="14" />
                </button>
                <button
                  v-tip="$t('action.expandAll')"
                  type="button"
                  class="sidebar__tool sidebar__tool--out"
                  :disabled="entities.allExpanded"
                  :aria-label="$t('action.expandAll')"
                  @click="entities.expandAll()"
                >
                  <AppIcon name="arrowsOut" :size="14" />
                </button>
              </div>
            </div>

            <EntityTree v-if="rail === 'entities'" />
            <ChatList v-else-if="rail === 'chats'" />
            <JobList v-else-if="rail === 'jobs'" />
            <SavedQueryList v-else-if="rail === 'queries'" />
            <HistoryList v-else />
          </aside>
        </div>
      </div>

      <ResizeHandle
        v-model:size="sidebarWidth"
        :class="{ 'handle--hidden': sidebarCollapsed }"
        :min="180"
        :max="520"
        :aria-label="$t('workspace.entities')"
        @reset="resetSidebarWidth"
      />

      <!--
        The corner, and the thing that fills what it cuts away.
        ──────────────────────────────────────────────────────
        An arc taken out of an opaque pane shows whatever is behind it, and
        behind it is the root — which is transparent, so the notch showed the
        material the OS draws outside the window: raw, where the column an
        eighth of an inch away shows it tinted. That patch is the rectangle
        behind the rounded corner.

        So the notch is filled by a wedge wearing the columns' own material,
        masked to the arc so it never overlaps the pane — glass laid over an
        opaque surface composites against *it* rather than against the window,
        and comes out a shade off the bar it is meant to continue.

        Only while the sidebar is shut. Open, the pane's top edge is the strip
        wearing the pane's own material, and a corner between them would be a
        seam inside one surface.
      -->
      <div
        v-if="sidebarCollapsed"
        class="content__notch mat-regular panel-sidebar"
        aria-hidden="true"
      />

      <section class="content panel-content" :class="{ 'content--alone': sidebarCollapsed }">
        <div class="content__body">
          <template v-for="tab in tabs.tabs" :key="tab.id">
            <div
              v-show="tab.id === tabs.activeId"
              class="content__pane"
              :class="{ 'content__pane--opening': opening.has(tab.id) }"
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
              <ChatTab
                v-else-if="tab.kind === 'chat'"
                :tab-id="tab.id"
                :active="tab.id === tabs.activeId"
                :scope="tab.ask"
                @configure="providersOpen = true"
                @sign-in="askToSignIn"
              />
            </div>
          </template>

          <div v-if="tabs.tabs.length === 0" class="content__empty">
            <!--
              The starting points, as the same three rows the `+` offers.
              ─────────────────────────────────────────────────────────
              It was a heading, a sentence and two buttons floating in the
              middle of a very large dark rectangle — which is the shape an
              empty state takes when nobody has decided what it is *for*. It is
              for starting, so it lists the ways to start, in the vocabulary the
              rest of the window already uses: an icon, a name, and the key that
              skips the click.

              The connection's own badge heads it, because this pane belongs to
              a database and saying which one costs a line and answers the
              question somebody arriving at an empty window actually has.
            -->
            <div class="opening">
              <span
                v-if="connections.active"
                class="opening__mark"
                :style="{ '--engine-hue': engineHue }"
                aria-hidden="true"
              >
                <EngineMark :engine="connections.active.engine" :size="28" />
              </span>

              <h2 class="opening__title">
                {{ connections.active?.name }}
              </h2>
              <p class="opening__note">
                {{ $t('workspace.nothingOpenHint') }}
              </p>

              <ul class="opening__ways">
                <li v-for="way in openings" :key="way.id">
                  <button type="button" class="opening__way focus-fill" @click="way.run()">
                    <span class="opening__icon" aria-hidden="true">
                      <AppIcon :name="way.icon" :size="16" />
                    </span>
                    <span class="opening__label">{{ way.label }}</span>
                    <kbd class="opening__key">{{ way.hint }}</kbd>
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </div>

    <StatusBar />

    <CommandPalette
      v-model="paletteOpen"
      @open-settings="settingsOpen = true"
      @open-shortcuts="shortcutsOpen = true"
      @open-storage="storageOpen = true"
      @diagnose="diagnoseOpen = true"
      @new-connection="editingConnection = null"
      @reset-sidebar="resetSidebarWidth"
    />
    <SettingsSheet
      v-model="settingsOpen"
      @manage-providers="providersOpen = true"
      @manage-shortcuts="shortcutsOpen = true"
      @manage-storage="storageOpen = true"
    />
    <ProviderSheet v-model="providersOpen" />
    <CliSignInSheet v-model="signInOpen" :kind="signInKind" />
    <ShortcutSheet v-model="shortcutsOpen" />
    <StorageSheet v-model="storageOpen" />
    <DiagnoseSheet v-model="diagnoseOpen" />

    <ConnectionEditor
      v-if="editingConnection !== undefined"
      :editing="editingConnection"
      :keyring-available="connections.keyringAvailable"
      @close="editingConnection = undefined"
      @saved="onConnectionSaved"
    />
  </div>
</template>

<style scoped>
/*
 * How wide the two glass columns are, declared once.
 *
 * Three things have to agree on this number: the sidebar is it, the working
 * pane begins after it, and the bar above is divided at it — the columns'
 * surface on one side, the pane's on the other. Each used to work it out for
 * itself, which is that many chances for one to be left behind when the
 * sidebar moves, and the tab strip was the one that had been: it began after
 * the toggle button, at an offset that matched nothing else in the window.
 *
 * `--sidebar-w` is the only part that comes from the interface, because it is
 * the only part a reader can drag. Everything below is derived from it, so the
 * collapse animates every dependent property from the same source on the same
 * curve.
 */
.workspace {
  --columns-w: calc(var(--rail-w) + var(--sidebar-w, 0px));
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
  height: max(var(--tab-h), var(--controls-h, 0px));
}

/*
 * The bar's first region is the columns' width, and wears the columns' surface.
 *
 * The bar had a shade of its own, which made the window three surfaces stacked
 * in a T: two columns below, one band across the top. It reads better as two
 * columns that run the full height, with the tab strip sitting on the working
 * pane the way a tab strip does everywhere else — so this half continues the
 * sidebar upward and the strip continues the pane upward, and the seam between
 * them is the same vertical line all the way down.
 *
 * That line is nowhere near the traffic lights: it falls at the columns'
 * trailing edge, three hundred pixels in. The rule this looks like it breaks is
 * about a boundary running *under the controls*, and it still holds.
 *
 * Empty, deliberately: it is the controls' room and the columns' width, and
 * nothing in this bar acts on the columns any more. Sized in `border-box`, so
 * the inset for the controls and the gap before the first tab are both inside
 * that width rather than added to it.
 *
 * `min-width` rather than `width`, because collapsing the sidebar takes the
 * offset down to the rail alone — narrower than the traffic lights — and a tab
 * strip sliding under the window controls is the one thing this bar exists to
 * prevent.
 */
.topbar__lead {
  box-sizing: border-box;
  flex: 0 0 auto;
  min-width: var(--columns-w);
  height: 100%;
  padding-inline: max(var(--gap-tight), var(--controls-inset, 0px)) var(--gap-tight);
  transition: min-width var(--t-panel) var(--ease-sheet);
}

@media (prefers-reduced-motion: reduce) {
  .topbar__lead {
    transition: none;
  }
}

.workspace__main {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
}

/*
 * One column, one surface, the database at the top of it.
 *
 * The rail and the sidebar were two elements each painting the glass, which is
 * how they came to be described as "one surface" in a rule rather than simply
 * being one. Here they are one: the material is declared once, on the column
 * that holds both, and nothing inside it paints anything.
 */
/*
 * As wide as the two columns, and no wider.
 *
 * Collapsing the sidebar takes `--sidebar-w` to zero, which has to take this
 * with it — a connection tile spanning a width the panel underneath has given
 * up is a tile holding the sidebar open on its own. Clipped, so the row inside
 * simply runs out of room rather than needing a second layout for the narrow
 * case, and the mark is the part that survives: it is the one piece that still
 * says which database this is at rail width.
 */
.leftpanel {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  min-height: 0;
  width: var(--columns-w);
  overflow: hidden;
  transition: width var(--t-panel) var(--ease-sheet);
}

@media (prefers-reduced-motion: reduce) {
  .leftpanel {
    transition: none;
  }
}

.leftpanel__body {
  display: flex;
  flex: 1;
  min-height: 0;
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
  color: var(--text-soft);
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

/* Pushed to the foot of the column; whatever follows it sits under it. */
.rail__item--bottom {
  margin-top: auto;
}

/*
 * Pressed means the sidebar is showing.
 *
 * The glyph brightens and nothing else. The rail's *selected* state is a tonal
 * tile with a marker travelling to it, and that state means "this is the panel
 * you are looking at" — a sixth tile lit in the same way would say the sidebar
 * is a destination beside the five, when it is the switch that shows them.
 */
.rail__item[aria-pressed='true'] {
  color: var(--color-base-content);
}

/* Above the status bar rather than tucked into the window's corner. */
.rail__item--gear {
  margin-bottom: var(--gap);
}

.rail__item--gear :deep(.icon) {
  transition: transform var(--t-hover) var(--ease-out);
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
  width: var(--sidebar-w, 0px);
  transition: width var(--t-panel) var(--ease-sheet);
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
  color: var(--text-soft);
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

/*
 * A count on the control, sized like the number it holds rather than like a
 * button: no fixed width, because "1" and "4" are the only values it ever
 * takes and a circle drawn for two digits reads as a badge waiting for one.
 */
/* Holds the row's height while the chat panel supplies its own field below. */
.sidebar__badge {
  min-width: 1.1em;
  padding-inline: 0.28em;
  border-radius: 999px;
  background: var(--color-primary);
  color: var(--color-primary-content, #fff);
  font-size: 0.625rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.45;
  text-align: center;
}

/*
 * The same quiet field the structure popup uses: a tinted well, the glyph at
 * the leading edge, and no drawn border at rest.
 *
 * What happens on focus is the whole of the animation. The well lifts toward
 * the working surface, the glyph brightens from a hint to a label, and the
 * focus fill arrives over the top — three properties on one curve, so it reads
 * as the field waking rather than as a ring being switched on. A border that
 * blinks from transparent to accent is a state change; this is a response.
 */
.sidebar__find {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--gap-tight);
  min-width: 0;
  height: var(--field-h);
  padding-inline: var(--gap);
  border-radius: var(--control-radius);
  background: var(--fill-4);
  color: var(--text-soft);
  transition:
    background-color var(--t-hover) var(--ease-out),
    color var(--t-hover) var(--ease-out),
    box-shadow var(--t-hover) var(--ease-out);
}

@media (hover: hover) and (pointer: fine) {
  .sidebar__find:hover {
    background: var(--fill-3);
  }
}

.sidebar__find:focus-within {
  background: var(--fill-2);
  color: var(--color-base-content);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--color-primary) 55%, transparent);
}

.sidebar__find-icon {
  flex: none;
  transition: transform var(--t-pop) var(--ease-out);
}

/* It leans in by a hair when the field takes the caret — the smallest possible
   acknowledgement that the thing under the pointer is now listening. */
.sidebar__find:focus-within .sidebar__find-icon {
  transform: scale(1.08);
}

.sidebar__find-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: none;
  color: var(--color-base-content);
  font-size: 0.75rem;
}

.sidebar__find-input::placeholder {
  color: var(--text-soft);
}

.sidebar__find-input:focus {
  outline: none;
}

/* The magnifier is the affordance; the browser's own clear button is a second,
   differently drawn one sitting beside it. */
.sidebar__find-input::-webkit-search-cancel-button {
  appearance: none;
}

@media (prefers-reduced-motion: reduce) {
  .sidebar__find,
  .sidebar__find-icon {
    transition: none;
    transform: none;
  }
}

.sidebar__counts {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  height: var(--sidebar-row-h);
  gap: var(--gap);
  padding: 0 var(--gap);
  color: var(--text-soft);
}

/*
 * The count yields before the controls do.
 *
 * At 180px — the narrowest the column goes — the row is the count and three
 * targets, and the targets are the part that has to stay reachable. So the text
 * is the flexible one and truncates, rather than the tools wrapping to a second
 * row or being pushed out of the box.
 */
.sidebar__count {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar__tools {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--gap-hair);
  margin-inline-start: auto;
}

.sidebar__tool {
  display: grid;
  place-items: center;
  width: var(--hit-min);
  height: var(--hit-min);
  border-radius: var(--radius-field);
  color: inherit;
  transition:
    background-color var(--t-hover) var(--ease-out),
    color var(--t-hover) var(--ease-out),
    opacity var(--t-hover) var(--ease-out),
    transform var(--t-press) var(--ease-out);
}

/* The same press the rest of the app's buttons answer with. */
.sidebar__tool:active:not(:disabled) {
  transform: scale(0.94);
}

.sidebar__tool:hover:not(:disabled) {
  background: var(--fill-2);
  color: var(--color-base-content);
}

/*
 * On, not pressed: a mode wears its surface for as long as it is in force,
 * which is the tab toolbars' rule and the rail's.
 *
 * The hovered form is spelled out with the same three parts as the hover rule
 * above it rather than as a bare `--on:hover`. Coming later in the file is not
 * enough — `.sidebar__tool:hover:not(:disabled)` is a class and two
 * pseudo-classes and outranks two classes, so the neutral fill won and a lit
 * tile went grey under the pointer that had just lit it.
 */
.sidebar__tool--on,
.sidebar__tool--on:hover:not(:disabled) {
  background: color-mix(in oklab, var(--color-primary) 14%, transparent);
  color: var(--color-primary-text, var(--color-primary));
}

/*
 * The arrows preview the gesture a moment before the click lands: pulled
 * together for the one that closes, drawn apart for the one that opens. It is
 * the whole of what makes an icon pair legible without a word beside it.
 */
.sidebar__tool :deep(.icon) {
  transition: transform var(--t-hover) var(--ease-out);
}

.sidebar__tool--in:hover:not(:disabled) :deep(.icon) {
  transform: scaleY(0.78);
}

.sidebar__tool--out:hover:not(:disabled) :deep(.icon) {
  transform: scaleY(1.22);
}

/*
 * Same height, same shape, as wide as its word. `width` rather than `min-width`
 * is what the square tiles are given, so a named one has to say so — and it
 * lays out as a flex row rather than a centring grid, or the icon and the label
 * stack on top of each other.
 */
.sidebar__tool--named {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  width: auto;
  padding-inline: var(--gap);
}

/*
 * A mode and two actions are two groups, and proximity is what says so — the
 * hair gap alone made them read as one set of three unrelated things.
 */
.sidebar__tool--mode {
  margin-inline-end: var(--gap-tight);
}

/* Dimmed, never hidden: a control that vanishes at its extreme moves the one
   beside it under the pointer that is reaching for it. */
.sidebar__tool:disabled {
  opacity: 0.3;
}

/*
 * Reduced motion keeps the colour and drops the movement: the tonal surface and
 * the hover fill still say what they said, and the arrows simply stop
 * rehearsing the gesture.
 */
@media (prefers-reduced-motion: reduce) {
  .sidebar__tool,
  .sidebar__tool :deep(.icon) {
    transition:
      background-color var(--t-hover) var(--ease-out),
      color var(--t-hover) var(--ease-out);
  }

  .sidebar__tool:active:not(:disabled),
  .sidebar__tool--in:hover:not(:disabled) :deep(.icon),
  .sidebar__tool--out:hover:not(:disabled) :deep(.icon) {
    transform: none;
  }
}

.sidebar__todo {
  padding: var(--gap-loose);
  color: var(--text-soft);
}

/*
 * Rounded only where there is something for a corner to mean.
 *
 * Open, the pane's top edge *is* the strip, wearing the pane's own material, so
 * a corner between them would be a seam inside one surface. Shut, the bar above
 * and the rail beside are both the columns' material and the pane is an opaque
 * panel sitting in front of them — which is the one arrangement where softening
 * the meeting point is softening something.
 *
 * `clip-path`, never `overflow`: Chromium drops an ancestor's rounded overflow
 * clip on a layer of its own, Monaco promotes itself, and the corner was
 * correspondingly cut on a table tab and square on a query tab.
 */
.content--alone {
  clip-path: inset(0 round var(--radius-box) 0 0 0);
}

/*
 * The wedge that fills what the arc cuts away.
 *
 * Exactly the corner box, painting everywhere in it except inside the arc, so
 * it meets the clipped pane edge to edge and never laps over it. Its neighbours
 * are the bar directly above and the rail directly beside, both wearing this
 * same material, so the three read as one surface with the pane in front of it.
 */
.content__notch {
  position: absolute;
  z-index: 2;
  top: 0;
  inset-inline-start: var(--columns-w);
  width: var(--radius-box);
  height: var(--radius-box);
  pointer-events: none;
  mask-image: radial-gradient(
    circle at 100% 100%,
    transparent calc(var(--radius-box) - 0.5px),
    #000 var(--radius-box)
  );
}

/*
 * Square, because the tab strip is now the pane's own top edge.
 *
 * There was one rounded corner here, backed by a masked wedge of the sidebar's
 * surface so the arc did not show raw window backdrop through it. It was there
 * to soften the one place the opaque pane butted into the chrome above it — and
 * there is no such place any more: the strip wears the pane's surface and sits
 * directly on it, so the two are one column with a row of tabs at the top of it
 * rather than two things meeting at a corner.
 */
.content {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  /* The grid and the editor both paint to their own edges. */
  overflow: hidden;
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

/*
 * The regions of a new tab arrive in order.
 * ─────────────────────────────────────────
 * `> * > *` is the tab component's own top-level regions — the editor, the
 * divider, the toolbar, the results — rather than the component root, because
 * animating the root is one box fading, which is the thing that already looked
 * like a jump cut with a fade on it.
 *
 * `backwards` so each region holds its first frame through its own delay
 * instead of being painted in place and then snapping back to start.
 */
.content__pane--opening > * > * {
  animation: pane-region-in var(--t-sheet) var(--ease-out) backwards;
}

.content__pane--opening > * > :nth-child(2) {
  animation-delay: 45ms;
}

.content__pane--opening > * > :nth-child(3) {
  animation-delay: 90ms;
}

.content__pane--opening > * > :nth-child(4) {
  animation-delay: 135ms;
}

.content__pane--opening > * > :nth-child(n + 5) {
  animation-delay: 175ms;
}

@keyframes pane-region-in {
  from {
    opacity: 0;
    /*
     * Offset only, and a small one: a larger move on a full-width region reads
     * as the whole pane sliding rather than as its parts settling.
     *
     * Not scaled. A scale on a region holding the grid changes the width its
     * container measures, so the grid refit its columns when the animation
     * ended — a full remeasure of every loaded row, for a frame of decoration.
     * The invariant that catches it is `switching back to a tab does not redraw
     * its grid`.
     */
    transform: translateY(6px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .content__pane--opening > * > * {
    animation: pane-region-fade var(--t-hover) var(--ease-out) backwards;
  }

  @keyframes pane-region-fade {
    from {
      opacity: 0;
    }
  }
}

.content__todo,
/*
 * The empty pane, as a place to start from.
 *
 * A `stagger` on the way in: the badge, then the name, then each way in turn.
 * An empty pane appears when the last tab closes as well as when the window
 * opens, and something that simply *is there* in the frame after a close reads
 * as a glitch — arriving says the pane changed rather than the app blinked.
 */
/*
 * Objects, and only just.
 *
 * The first attempt drew all three ways in at the weight of a caption, so the
 * only thing on an empty pane with any presence was the note above it saying
 * there was nothing on it. The second overcorrected: an outlined card on a
 * *darker* fill than the pane, holding a grey tile and a bordered chip — four
 * edges and three greys for a row that says two words.
 *
 * A card standing off a field is `--surface-raised`, which is lighter than the
 * pane on the light theme and lighter on the dark one too, because raised is a
 * direction rather than a colour. Separation is that step in tone and nothing
 * else — no outline and no shadow. Both were tried: the outline made four edges
 * for a row that says two words, and the shadow put an object on a page that is
 * asking a question, not presenting a result.
 *
 * The glyph keeps a tile because it is the row's subject, at a fill quiet
 * enough to read as a place for it rather than as a second card inside the
 * first.
 */
.opening {
  display: grid;
  justify-items: center;
  gap: var(--gap-tight);
  width: min(27rem, 100%);
  text-align: center;
}

.opening > * {
  animation: opening-in var(--t-sheet) var(--ease-out) backwards;
}

.opening__mark {
  display: grid;
  place-items: center;
  width: 3.25rem;
  height: 3.25rem;
  margin-bottom: var(--gap);
  border-radius: 1rem;
  background: linear-gradient(
    145deg,
    oklch(64% 0.16 var(--engine-hue)),
    oklch(52% 0.17 var(--engine-hue))
  );
  color: oklch(99% 0 0);
  font-size: 0.9375rem;
  font-weight: 650;
}

/*
 * The container is muted; the name and the actions are not.
 *
 * `.content__empty` dims everything inside it, which was right when it held two
 * grey sentences and is wrong now that it holds the page's only controls — a
 * button drawn at 45% of the text colour reads as disabled.
 */
.opening__title {
  margin: 0;
  color: var(--color-base-content);
  /* Type that grows tightens. */
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.018em;
  animation-delay: 40ms;
}

.opening__note {
  max-width: 24rem;
  margin: 0 0 var(--gap-section);
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--text-soft);
  animation-delay: 80ms;
}

.opening__ways {
  display: grid;
  gap: var(--gap-tight);
  width: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
  animation-delay: 120ms;
}

.opening__way {
  display: flex;
  align-items: center;
  gap: var(--gap);
  width: 100%;
  min-height: 3rem;
  padding-inline: var(--gap) var(--gap-loose);
  border-radius: var(--radius-box);
  background: var(--surface-raised);
  text-align: start;
  transition:
    background-color var(--t-hover) var(--ease-out),
    transform var(--t-press) var(--ease-out);
}

@media (hover: hover) and (pointer: fine) {
  .opening__way:hover {
    background: color-mix(in oklab, var(--surface-raised) 100%, var(--color-base-content) 6%);
  }
}

.opening__way:active {
  transform: scale(0.99);
}

/* The glyph gets a tile of its own, so it reads as the row's subject rather
   than as punctuation before the label — at the lightest fill there is, or it
   becomes a second card inside the first. */
.opening__icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 0.5rem;
  background: var(--fill-4);
  color: var(--color-primary-text);
}

.opening__label {
  flex: 1;
  color: var(--color-base-content);
  font-size: 0.9375rem;
  font-weight: 550;
  letter-spacing: -0.005em;
}

/* The keystroke is a fact about the row, not a control on it — so no chrome of
   its own, just the tabular figures and a quiet colour. */
.opening__key {
  flex: 0 0 auto;
  font-family: inherit;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-soft);
}

@keyframes opening-in {
  from {
    opacity: 0;
    transform: translateY(0.375rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .opening > * {
    animation: none;
  }

  .opening__way {
    transition: none;
  }
}

.content__empty {
  display: grid;
  place-content: center;
  justify-items: center;
  gap: var(--gap-tight);
  height: 100%;
  text-align: center;
  color: var(--text-soft);
}

.content__actions {
  display: flex;
  gap: var(--gap);
}

.content__hint {
  max-width: 22rem;
}
</style>
