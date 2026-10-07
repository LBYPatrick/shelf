<script setup lang="ts">
/** A searchable library with bounded pages, sharing the workspace materials. */
import { computed, onMounted, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { elapsedSince, FOREVER } from '@shared/elapsed';
import type { SavedConnection } from '@shared/connections';
import { looksLikeUrl, parseConnectionUrl, type ParsedConnection } from '@shared/connectionUrl';
import { parseConnections, serializeConnections } from '@shared/connectionFile';
import { documentFileName } from '@shared/fileNames';
import { errorMessage } from '@shared/errors';
import { engineDescriptor } from '@shared/engines';
import ContextMenu, { type MenuItem } from '../components/ui/ContextMenu.vue';
import ConnectionEditor from '../components/connection/ConnectionEditor.vue';
import LineupRow from '../components/connection/LineupRow.vue';
import AppIcon from '../components/ui/AppIcon.vue';
import SegmentedControl from '../components/ui/SegmentedControl.vue';
import SqlCode from '../components/assistant/SqlCode.vue';
import { useTabs } from '../stores/tabs';
import { HISTORY_LIMIT, type HistoryEntry } from '@shared/appdb';
import DisclosureGroup from '../components/ui/DisclosureGroup.vue';
import SettingsSheet from '../components/settings/SettingsSheet.vue';
import ShortcutSheet from '../components/settings/ShortcutSheet.vue';
import StorageSheet from '../components/settings/StorageSheet.vue';
import ProviderSheet from '../components/assistant/ProviderSheet.vue';
import Sheet from '../components/ui/Sheet.vue';
import PressButton from '../components/ui/PressButton.vue';
import { vTip } from '../lib/hoverTip';
import { useConnections } from '../stores/connections';
import { useToasts } from '../stores/toasts';

const props = defineProps<{ embedded?: boolean }>();
const emit = defineEmits<{ connected: []; 'editing-change': [boolean] }>();
const removing = ref<SavedConnection>();
const removeOpen = ref(false);
const removeBusy = ref(false);
const removeError = ref('');

const connections = useConnections();
const toasts = useToasts();
const { t } = useTranslation();

const history = ref<HistoryEntry[]>([]);
const selectedHistory = ref<HistoryEntry>();
const historyOpen = ref(false);
const tabs = useTabs();
const view = ref('saved');
const page = ref(0);
const scroller = ref<HTMLElement>();
watch(
  [page, view],
  () => {
    if (scroller.value) scroller.value.scrollTop = 0;
  },
  { flush: 'post' }
);
const PAGE_SIZE = 40;
const viewOptions = computed(() => [
  { value: 'saved', label: t('start.saved') },
  { value: 'recent', label: t('start.recent') },
  ...(!props.embedded ? [{ value: 'history', label: t('start.queryHistory') }] : []),
]);
const search = ref('');
watch([view, search], () => {
  page.value = 0;
  if (scroller.value) scroller.value.scrollTop = 0;
});
/** A pasted URL is an offer to add a connection, not a filter over the list. */
const parsed = computed(() =>
  looksLikeUrl(search.value) ? parseConnectionUrl(search.value) : undefined
);

const needle = computed(() => (parsed.value ? '' : search.value.trim().toLowerCase()));

function haystack(connection: SavedConnection): string {
  const config = connection.config;
  return [connection.name, config.host, config.database, config.filePath, connection.engine]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

const connectionRows = computed(() => {
  const rows = connections.saved.filter((entry) => haystack(entry).includes(needle.value));
  if (view.value === 'recent')
    return rows
      .filter((entry) => entry.lastUsedAt !== null)
      .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
  return rows.sort((a, b) => a.name.localeCompare(b.name));
});
const connectionNames = computed(
  () => new Map(connections.saved.map((entry) => [entry.id, entry.name]))
);
const historyRows = computed(() =>
  history.value.filter((entry) => {
    return [entry.text, connectionNames.value.get(entry.connectionId ?? '') ?? '']
      .join(' ')
      .toLowerCase()
      .includes(needle.value);
  })
);
const count = computed(() =>
  view.value === 'history' ? historyRows.value.length : connectionRows.value.length
);
const pages = computed(() => Math.max(1, Math.ceil(count.value / PAGE_SIZE)));
const historyPage = computed(() =>
  historyRows.value.slice(page.value * PAGE_SIZE, (page.value + 1) * PAGE_SIZE)
);
watch(pages, (total) => {
  page.value = Math.min(page.value, total - 1);
});
async function openHistory(entry: HistoryEntry): Promise<void> {
  const connection = connections.saved.find((saved) => saved.id === entry.connectionId);
  if (!connection) return;
  tabs.queueQuery(connection.id, entry.text);
  if (await connections.connect(connection)) emit('connected');
  else tabs.clearQueuedQuery();
}
async function copyStatement(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toasts.show({ tone: 'success', message: t('assistant.copied') });
  } catch (caught) {
    toasts.show({ tone: 'error', message: errorMessage(caught) });
  }
}
function historyConnection(entry: HistoryEntry): string {
  return (
    connections.saved.find((saved) => saved.id === entry.connectionId)?.name ??
    t('start.unavailableConnection')
  );
}
const editing = ref<SavedConnection | null | undefined>(undefined);
// The root keeps this view through the editor's actual leave. Connecting may
// finish first; database work is never made to wait for a visual transition.
watch(editing, (value) => emit('editing-change', value !== undefined), { immediate: true });
const seed = ref<ParsedConnection | undefined>(undefined);
const opening = ref<string | null>(null);
const sampling = ref(false);
const settingsOpen = ref(false);
const shortcutsOpen = ref(false);
const storageOpen = ref(false);
const providersOpen = ref(false);

/**
 * Which groups are unfolded. All of them, to start.
 *
 * The sample in particular: it is the only way in for someone whose first run
 * this is, and a way in behind a fold is one they have to be told about.
 */
const unfolded = ref<Record<string, boolean>>({ sample: true });

onMounted(() => {
  void connections.refresh();
  if (!props.embedded) {
    void window.shelf.db
      .listHistory(null, HISTORY_LIMIT)
      .then((entries) => {
        history.value = entries;
      })
      .catch((caught) => toasts.show({ tone: 'error', message: errorMessage(caught) }));
  }
});

interface Group {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly SavedConnection[];
}

const groups = computed<Group[]>(() =>
  view.value === 'history'
    ? []
    : [
        {
          id: 'library',
          title: view.value === 'recent' ? t('start.recent') : t('start.saved'),
          rows: connectionRows.value.slice(
            page.value * PAGE_SIZE,
            (page.value + 1) * PAGE_SIZE
          ),
        },
      ].filter((group) => group.rows.length)
);

const nothingMatches = computed(() => count.value === 0);

/** What this connection actually points at, in one line. */
function where(connection: SavedConnection): string {
  const config = connection.config;
  if (config.filePath) return config.filePath.split(/[\\/]/).slice(-2).join('/');
  if (config.host) {
    return config.database ? `${config.host}/${config.database}` : config.host;
  }
  return engineDescriptor(connection.engine).name;
}

function lastUsed(connection: SavedConnection): string {
  const at = connection.lastUsedAt;
  if (!at) return t('start.neverOpened');

  /*
   * The same arithmetic and the same words the sidebar's lists use. This one
   * keeps counting past a week rather than falling back to a date: a
   * connection last opened four hundred days ago is a connection you have
   * stopped using, and that is the useful thing to say about it.
   */
  const since = elapsedSince(at, Date.now(), { until: FOREVER });
  switch (since.unit) {
    case 'now':
      return t('time.justNow');
    case 'minutes':
      return t('time.minutesAgo', { count: since.count });
    case 'hours':
      return t('time.hoursAgo', { count: since.count });
    default:
      return t('time.daysAgo', { count: since.count });
  }
}

/** One anchored menu keeps secondary actions out of the tile's reading flow. */
const actionMenu = ref(false);
const actionAt = ref({ x: 0, y: 0 });
const actionTrigger = ref<HTMLElement>();
const actionConnection = ref<SavedConnection | null>(null);

const actionItems = computed<MenuItem[]>(() => [
  { id: 'edit', label: t('action.edit'), icon: 'pencil' },
  { id: 'duplicate', label: t('action.duplicate'), icon: 'copy' },
  {
    id: 'notice',
    label: t('connection.exportIncludesSecrets'),
    disabled: true,
    startsGroup: true,
  },
  { id: 'file', label: t('start.exportToFile'), icon: 'download' },
  { id: 'clipboard', label: t('start.exportToClipboard'), icon: 'copy' },
  { id: 'delete', label: t('action.delete'), icon: 'close', startsGroup: true },
]);

function openActions(connection: SavedConnection, event: MouseEvent): void {
  const trigger = event.currentTarget as HTMLElement;
  if (actionMenu.value && actionTrigger.value === trigger) {
    actionMenu.value = false;
    return;
  }
  const box = trigger.getBoundingClientRect();
  actionConnection.value = connection;
  actionTrigger.value = trigger;
  actionAt.value = { x: box.right, y: box.bottom };
  actionMenu.value = true;
}

function chooseAction(id: string): void {
  const connection = actionConnection.value;
  if (!connection) return;
  switch (id) {
    case 'edit':
      seed.value = undefined;
      editing.value = connection;
      break;
    case 'duplicate':
      void duplicate(connection);
      break;
    case 'file':
      void exportConnection(connection);
      break;
    case 'clipboard':
      void copyConnection(connection);
      break;
    case 'delete':
      requestRemove(connection);
      break;
  }
}

/** The document, and whether it carries anything worth warning about. */
async function connectionDocument(
  connection: SavedConnection
): Promise<{ text: string; carried: boolean }> {
  const secrets = await window.shelf.db.revealSecrets(connection.id).catch(() => ({}));
  return {
    text: serializeConnections([connection], { [connection.id]: secrets }),
    carried: Object.keys(secrets).length > 0,
  };
}

async function exportConnection(connection: SavedConnection): Promise<void> {
  const { text, carried } = await connectionDocument(connection);

  const path = await window.shelf.dialogs.writeTextFile(
    {
      title: t('start.exportTitle'),
      defaultPath: documentFileName(connection.name, 'connection'),
      extensions: ['json'],
    },
    text
  );
  if (!path) return;

  toasts.show({
    id: 'connection-export',
    tone: carried ? 'warning' : 'success',
    ...(carried ? { title: t('start.exportedWithSecrets') } : {}),
    message: carried ? t('start.exportedWithSecretsNote') : t('start.exported'),
  });
}

/**
 * The same document, on the clipboard.
 *
 * Warned about more loudly than the file, and that is the point rather than an
 * oversight: a file goes where you put it, and the clipboard is readable by
 * everything else running on this machine and is one absent-minded paste from
 * a chat window. Same document, same `secrets` key, a sharper sentence.
 */
async function copyConnection(connection: SavedConnection): Promise<void> {
  const { text, carried } = await connectionDocument(connection);

  try {
    await navigator.clipboard.writeText(text);
  } catch (caught) {
    toasts.show({ tone: 'error', message: errorMessage(caught) });
    return;
  }

  toasts.show({
    id: 'connection-export',
    tone: carried ? 'warning' : 'success',
    ...(carried ? { title: t('start.copiedWithSecrets') } : {}),
    message: carried ? t('start.copiedWithSecretsNote') : t('start.copied'),
  });
}

/** Reads a document of presets and saves every connection in it. */
async function importPresets(): Promise<void> {
  const file = await window.shelf.dialogs.readTextFile({
    title: t('start.importTitle'),
    extensions: ['json'],
  });
  if (!file) return;

  const result = parseConnections(file.text);
  if (!result.ok) {
    toasts.show({
      id: 'connection-import',
      tone: 'error',
      title: t('start.importFailed'),
      message: result.error,
    });
    return;
  }

  let imported = 0;
  try {
    for (const input of result.connections) {
      await connections.save(input);
      imported++;
    }
  } catch (caught) {
    toasts.show({
      tone: 'error',
      title: t('start.imported', { n: imported }),
      message: errorMessage(caught),
    });
    return;
  }
  toasts.show({
    id: 'connection-import',
    tone: 'success',
    message: t('start.imported', { n: result.connections.length }),
  });
}

function requestRemove(connection: SavedConnection): void {
  removing.value = connection;
  removeError.value = '';
  removeOpen.value = true;
}
async function remove(): Promise<void> {
  if (!removing.value || removeBusy.value) return;
  removeBusy.value = true;
  try {
    await connections.remove(removing.value.id);
    removeOpen.value = false;
  } catch (caught) {
    removeError.value = errorMessage(caught);
  } finally {
    removeBusy.value = false;
  }
}
async function duplicate(connection: SavedConnection): Promise<void> {
  try {
    editing.value = await connections.duplicate(connection, t('noun.copy'));
  } catch (caught) {
    toasts.show({ tone: 'error', message: errorMessage(caught) });
  }
}
function startNew(): void {
  seed.value = undefined;
  editing.value = null;
}

/** A pasted URL goes straight into the editor with its fields already filled. */
function useParsed(): void {
  if (!parsed.value) return;
  seed.value = parsed.value;
  editing.value = null;
}

async function open(connection: SavedConnection): Promise<void> {
  opening.value = connection.id;
  try {
    if (await connections.connect(connection)) emit('connected');
  } finally {
    opening.value = null;
  }
}

async function openSample(): Promise<void> {
  sampling.value = true;
  try {
    if (await connections.exploreSample()) emit('connected');
  } finally {
    sampling.value = false;
  }
}

async function saved(connection: SavedConnection, connect: boolean): Promise<void> {
  search.value = '';
  if (connect) await open(connection);
}

/*
 * A connection that failed is a notification, not a paragraph.
 *
 * It used to be a tinted block wedged into the left pane, which pushed
 * everything under it down the moment it appeared and stayed until something
 * else happened. It is the same class of event as every other thing the app has
 * to tell you — the export that was written, the settings that were applied —
 * and it goes to the same place they do.
 */
watch(
  () => connections.status,
  (status) => {
    if (status.state !== 'failed') return;
    toasts.show({ id: 'connection-failed', tone: 'error', message: status.message });
  },
  { deep: true }
);
</script>

<template>
  <div class="manager" :class="embedded ? 'manager--embedded' : 'mat-regular panel-sidebar'">
    <div v-if="embedded" class="library-toolbar">
      <input
        v-model="search"
        class="textfield"
        :placeholder="view === 'history' ? $t('start.historySearch') : $t('start.search')"
        :aria-label="$t('start.searchLabel')"
        @keydown.enter="parsed && useParsed()"
      />
      <PressButton variant="glass" @click="importPresets">{{
        $t('start.importPresets')
      }}</PressButton>
      <PressButton variant="primary" @click="startNew">{{
        $t('connection.newTitle')
      }}</PressButton>
    </div>
    <button v-if="embedded && parsed" class="parsed" @click="useParsed">
      {{ $t('start.setUp') }} · {{ parsed.suggestedName }}
    </button>
    <!-- What this is, and how to start something that is not on the list. -->
    <aside v-if="!embedded" class="intro">
      <!--
        Traffic-light clearance and a surface to drag the window by, over this
        pane only: across the whole width it would sit on top of the list beside
        it and swallow the first inch of every scroll.
      -->
      <div class="intro__chrome drag-region" />
      <div class="intro__inner">
        <header class="identity" style="--step: 0">
          <span class="identity__edition type-label">{{ $t('start.workspaceLabel') }}</span>
          <h1 class="identity__title">
            {{ $t('app.name') }}
          </h1>
        </header>

        <p class="identity__description">{{ $t('start.welcomeBody') }}</p>
        <div class="intro__action" style="--step: 2">
          <LineupRow
            :title="$t('start.newConnection')"
            :subtitle="$t('start.newConnectionBody')"
            icon="plus"
            @open="startNew"
          />
          <LineupRow
            :title="$t('action.settings')"
            :subtitle="$t('start.settingsBody')"
            :label="$t('action.settings')"
            icon="settings"
            @open="settingsOpen = true"
          />
          <LineupRow
            :title="$t('start.importPresets')"
            :subtitle="$t('start.importPresetsBody')"
            icon="upload"
            @open="importPresets"
          />
        </div>

        <!--
          The sample sits with the databases rather than in a banner of its own.
          It is a real feature and not a demo hook: the same database backs the
          screenshots and the tests.
        -->
        <DisclosureGroup
          v-if="!embedded"
          v-model="unfolded.sample"
          :label="$t('start.sample')"
          class="fold"
          :style="{ '--step': groups.length }"
        >
          <div class="group__list">
            <LineupRow
              :title="$t('start.sampleTitle')"
              :subtitle="sampling ? $t('start.sampleOpening') : $t('start.sampleBody')"
              icon="database"
              :busy="sampling"
              @open="openSample"
            />
          </div>
        </DisclosureGroup>

        <p v-if="!connections.keyringAvailable" class="keyring" style="--step: 3">
          {{ $t('start.noKeyring') }}
        </p>
      </div>
    </aside>

    <!--
      Everything there is to open. The one part of the screen that grows without
      limit, so it is the one part that scrolls.
    -->
    <section class="browser" :class="{ 'panel-content': !embedded }">
      <header class="library-head">
        <div class="library-heading">
          <h2 class="type-title">{{ $t('start.library') }}</h2>
          <span class="library-count">{{ count.toLocaleString() }}</span>
        </div>
        <div v-if="!embedded" class="finder" style="--step: 1">
          <AppIcon class="finder__icon" name="search" :size="16" />

          <input
            v-model="search"
            class="finder__input"
            type="text"
            :placeholder="view === 'history' ? $t('start.historySearch') : $t('start.search')"
            spellcheck="false"
            autocomplete="off"
            :aria-label="$t('start.searchLabel')"
            @keydown.enter="parsed ? useParsed() : undefined"
          />

          <button
            v-if="search"
            class="finder__clear"
            type="button"
            :aria-label="$t('action.clear')"
            @click="search = ''"
          >
            <AppIcon name="close" :size="16" />
          </button>
        </div>

        <Transition name="rise">
          <button v-if="!embedded && parsed" class="parsed" type="button" @click="useParsed">
            <span class="parsed__label">{{ $t('start.recognised') }}</span>
            <span class="parsed__name">{{ parsed.suggestedName }}</span>
            <span class="parsed__engine">{{ parsed.engine }}</span>
            <span class="parsed__go">{{ $t('start.setUp') }} ↩</span>
          </button>
        </Transition>

        <SegmentedControl
          v-model="view"
          :options="viewOptions"
          :aria-label="$t('start.library')"
        />
      </header>
      <div ref="scroller" class="browser__scroll">
        <ul v-if="view === 'history'" class="history-list">
          <li v-for="entry in historyPage" :key="entry.id">
            <button
              class="history-entry focus-fill"
              @click="
                selectedHistory = entry;
                historyOpen = true;
              "
            >
              <AppIcon :name="entry.succeeded ? 'check' : 'warning'" :size="14" />
              <span class="history-entry__text"
                ><span class="history-entry__sql">{{
                  entry.text.replace(/\s+/g, ' ').trim()
                }}</span
                ><span class="history-entry__meta"
                  >{{ historyConnection(entry) }} ·
                  {{ new Date(entry.executedAt).toLocaleString() }}</span
                ></span
              >
              <AppIcon name="chevron" :size="12" />
            </button>
          </li>
        </ul>
        <div v-for="group in groups" :key="group.id" class="collection">
          <div class="group__list">
            <LineupRow
              v-for="(connection, index) in group.rows"
              :key="connection.id"
              :title="connection.name"
              :subtitle="where(connection)"
              :meta="lastUsed(connection)"
              :engine="connection.engine"
              :accent="connection.labelColor"
              :label="$t('start.connectTo', { name: connection.name })"
              :busy="opening === connection.id"
              mono
              class="group__row"
              :style="{ '--index': index }"
              @open="open(connection)"
            >
              <template v-if="connection.readOnly" #badge>
                <span class="flag">{{ $t('workspace.readOnly') }}</span>
              </template>

              <template #actions>
                <button
                  type="button"
                  class="rowaction"
                  :aria-label="$t('menu.actionsFor', { name: connection.name })"
                  v-tip="$t('menu.actionsFor', { name: connection.name })"
                  aria-haspopup="menu"
                  :aria-expanded="actionMenu && actionConnection?.id === connection.id"
                  @click="openActions(connection, $event)"
                >
                  <AppIcon name="more" :size="16" />
                </button>
              </template>
            </LineupRow>
          </div>
        </div>

        <p v-if="nothingMatches" class="blank">
          {{
            needle
              ? $t('start.noMatches')
              : view === 'history'
                ? $t('history.empty')
                : view === 'recent'
                  ? $t('start.noRecent')
                  : $t('start.nothingSaved')
          }}
        </p>
      </div>
      <footer v-if="pages > 1" class="library-foot">
        <span>{{ $t('start.pageCount', { page: page + 1, pages, count }) }}</span>
        <div class="library-pages">
          <PressButton :disabled="page === 0" @click="page--">{{
            $t('start.previousPage')
          }}</PressButton
          ><PressButton :disabled="page + 1 >= pages" @click="page++">{{
            $t('start.nextPage')
          }}</PressButton>
        </div>
      </footer>
    </section>

    <!--
      Settings asks; the view answers — and this view has to answer as fully as
      the workspace does. The shortcuts editor and the provider list were owned
      by the workspace alone, so opening Settings from the start screen gave you
      two rows whose buttons did nothing at all.
    -->
    <SettingsSheet
      v-model="settingsOpen"
      @manage-shortcuts="shortcutsOpen = true"
      @manage-providers="providersOpen = true"
      @manage-storage="storageOpen = true"
    />
    <ShortcutSheet v-model="shortcutsOpen" />
    <ProviderSheet v-model="providersOpen" />
    <StorageSheet v-model="storageOpen" />

    <ContextMenu
      v-model="actionMenu"
      :items="actionItems"
      :at="actionAt"
      :trigger="actionTrigger"
      @choose="chooseAction"
    />

    <Sheet
      v-model="removeOpen"
      :title="$t('connection.removeTitle', { name: removing?.name })"
      over-sheets
    >
      <p class="remove-copy">{{ $t('connection.removeHelp') }}</p>
      <p v-if="removeError" role="alert">{{ removeError }}</p>
      <template #footer>
        <PressButton :disabled="removeBusy" @click="removeOpen = false">{{
          $t('action.cancel')
        }}</PressButton>
        <PressButton variant="primary" :disabled="removeBusy" @click="remove">{{
          $t('action.delete')
        }}</PressButton>
      </template>
    </Sheet>
    <Sheet v-model="historyOpen" :title="$t('start.queryHistory')">
      <template v-if="selectedHistory">
        <p class="remove-copy">
          {{ historyConnection(selectedHistory) }} ·
          {{ new Date(selectedHistory.executedAt).toLocaleString() }}
        </p>
        <div class="history-statement selectable"><SqlCode :sql="selectedHistory.text" /></div>
        <p
          v-if="!connections.saved.some((saved) => saved.id === selectedHistory?.connectionId)"
          class="blank"
        >
          {{ $t('start.unavailableConnection') }}
        </p>
      </template>
      <template #footer>
        <PressButton @click="selectedHistory && copyStatement(selectedHistory.text)">{{
          $t('action.copy')
        }}</PressButton>
        <PressButton
          variant="primary"
          :disabled="
            !connections.saved.some((saved) => saved.id === selectedHistory?.connectionId)
          "
          @click="selectedHistory && openHistory(selectedHistory)"
          >{{ $t('assistant.openInTab') }}</PressButton
        >
      </template>
    </Sheet>
    <ConnectionEditor
      v-if="editing !== undefined"
      :editing="editing"
      :over-sheets="embedded"
      :seed="seed"
      :keyring-available="connections.keyringAvailable"
      @close="editing = undefined"
      @saved="saved"
    />
  </div>
</template>

<style scoped>
.manager {
  position: relative;
  display: grid;
  grid-template-columns: minmax(14rem, 0.36fr) minmax(0, 1fr);
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.intro {
  position: relative;
  min-width: 0;
  padding: calc(var(--titlebar-h) + var(--gap-section)) var(--gap-section) var(--gap-section);
  overflow-y: auto;
}
.intro__chrome {
  position: absolute;
  inset-inline: 0;
  top: 0;
  height: var(--titlebar-h);
}
.intro__inner {
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
}
.identity {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--gap);
}
.identity__title {
  margin: 0;
  font-size: clamp(2rem, 4vw, 3.5rem);
  font-weight: 600;
  letter-spacing: -0.05em;
  line-height: 1.1;
}
.identity__edition {
  color: var(--text-soft);
}
.identity__description {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.6;
  color: var(--text-soft);
}
.intro :deep(.row__sub) {
  white-space: normal;
}
.intro__action {
  border-block: 1px solid var(--separator);
}
.browser {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-inline-start: 1px solid var(--separator);
}
.library-head {
  flex: none;
  padding: calc(var(--titlebar-h) + var(--gap-section)) var(--gap-section) var(--gap-loose);
  display: flex;
  flex-direction: column;
  gap: var(--gap-loose);
  border-bottom: 1px solid var(--separator);
}
.library-heading {
  display: flex;
  align-items: baseline;
  gap: var(--gap);
}
.library-heading h2 {
  margin: 0;
}
.library-count {
  margin-inline-start: auto;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-soft);
}
.finder {
  display: flex;
  align-items: center;
  border-radius: var(--control-radius);
  background: var(--surface-well);
  border: 1px solid var(--separator);
}
.finder:focus-within {
  border-color: var(--color-primary-text);
}
.finder__icon {
  margin-inline-start: var(--gap);
  color: var(--text-soft);
}
.finder__input {
  flex: 1;
  min-width: 0;
  height: max(var(--hit-min), var(--field-h));
  padding-inline: var(--gap);
  border: 0;
  background: transparent;
  color: var(--color-base-content);
  font-size: 0.8125rem;
}
.finder__input:focus-visible {
  outline: none;
}
.finder__input::placeholder {
  color: var(--text-soft);
}
.finder__clear {
  display: grid;
  place-items: center;
  width: var(--hit-min);
  height: var(--hit-min);
  border-radius: var(--control-radius);
  color: var(--text-soft);
}
.parsed {
  display: flex;
  align-items: center;
  gap: var(--gap);
  padding: var(--gap);
  min-height: var(--hit-min);
  border-radius: var(--control-radius);
  border: 1px solid var(--separator);
  background: var(--fill-2);
  text-align: start;
  font-size: 0.75rem;
}
.parsed__label,
.parsed__go {
  color: var(--color-primary-text);
}
.parsed__name {
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.parsed__engine {
  color: var(--text-soft);
}
.parsed__go {
  margin-inline-start: auto;
  white-space: nowrap;
}
.browser__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--gap-loose) var(--gap-section);
  overflow-anchor: none;
}
.group__list {
  border: 1px solid var(--separator);
  border-radius: var(--radius-field);
  overflow: hidden;
}
.collection .group__list {
  display: grid;
  gap: var(--gap);
  border: none;
  border-radius: 0;
  overflow: visible;
}
.group__row {
  border: 1px solid var(--separator);
  border-radius: var(--radius-field);
}
.flag {
  color: var(--text-soft);
  font-size: 0.625rem;
  white-space: nowrap;
  flex: none;
  line-height: 1.4;
  padding: 0.125rem var(--gap-tight);
  border-radius: var(--control-radius);
  background: var(--fill-2);
}
.rowaction {
  display: grid;
  place-items: center;
  width: var(--hit-min);
  height: var(--hit-min);
  border-radius: var(--control-radius);
  color: var(--text-soft);
  transition:
    background-color var(--t-hover) ease,
    color var(--t-hover) ease;
}
.rowaction :deep(.icon) {
  transition: transform var(--t-press) var(--ease-out);
}
.rowaction:active :deep(.icon) {
  transform: scale(0.9);
}
.rowaction:focus-visible :deep(.icon) {
  transform: none;
  transition: none;
}
.blank {
  padding-block: var(--gap-section);
  text-align: center;
  font-size: 0.8125rem;
  color: var(--text-soft);
}
.keyring {
  margin: 0;
  font-size: 0.75rem;
  color: var(--color-warning);
}
.library-foot {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap);
  padding: var(--gap) var(--gap-section);
  border-top: 1px solid var(--separator);
  color: var(--text-soft);
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
}
.library-pages {
  display: flex;
  gap: var(--gap);
}
.history-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.history-list li + li {
  border-top: 1px solid var(--separator);
}
.history-entry {
  display: flex;
  align-items: center;
  gap: var(--gap);
  width: 100%;
  min-height: calc(var(--hit-min) + var(--gap-loose));
  padding: var(--gap);
  text-align: start;
  border-radius: var(--radius-field);
}
.history-entry__text {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
  min-width: 0;
  flex: 1;
}
.history-entry__sql {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-entry__meta {
  font-size: 0.6875rem;
  color: var(--text-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-statement {
  max-height: 24rem;
  overflow: auto;
  border-radius: var(--radius-field);
  background: var(--surface-well);
}
.remove-copy {
  font-size: 0.8125rem;
  line-height: 1.6;
}
.manager--embedded {
  height: auto;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--gap-loose);
}
.library-toolbar {
  display: flex;
  gap: var(--gap);
  align-items: center;
}
.library-toolbar input {
  flex: 1;
  min-width: 0;
  height: var(--field-h);
  border-radius: var(--radius-field);
  background: var(--surface-well);
  padding-inline: var(--gap);
}
.manager--embedded .browser {
  border: 0;
}
.manager--embedded .browser__scroll {
  padding: 0;
  max-height: 26rem;
}
.manager--embedded .library-head {
  padding: 0 0 var(--gap);
}
.manager--embedded .library-heading {
  display: none;
}
.manager--embedded .library-foot {
  padding-inline: 0;
}
.rise-enter-active,
.rise-leave-active {
  transition:
    opacity var(--t-pop) var(--ease-out),
    transform var(--t-pop) var(--ease-out);
}
.rise-enter-from,
.rise-leave-to {
  opacity: 0;
  transform: translateY(0.25rem);
}
@media (hover: hover) and (pointer: fine) {
  .rowaction:hover,
  .finder__clear:hover,
  .history-entry:hover {
    background: var(--fill-2);
    color: var(--color-base-content);
  }
}
@media (max-width: 700px) {
  .manager:not(.manager--embedded) {
    grid-template-columns: 12rem minmax(0, 1fr);
  }
  .intro {
    padding-inline: var(--gap-loose);
  }
}
@media (prefers-reduced-motion: reduce) {
  .rowaction:active :deep(.icon) {
    transform: none;
  }
  .rise-enter-from,
  .rise-leave-to {
    transform: none;
  }
}
</style>
