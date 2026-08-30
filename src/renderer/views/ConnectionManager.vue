<script setup lang="ts">
/**
 * The start screen.
 *
 * Two panes, the way a welcome window has worked on this platform for years:
 * what this is and how to start something new on the left, and everything you
 * could open on the right.
 *
 * The split is what makes the screen worth the window it is given. A single
 * centred stack leaves a large display mostly empty and still runs out of room
 * for a long list; side by side, the identity keeps its space, the list gets
 * the height, and neither pushes the other around.
 *
 * On the right the databases are grouped and each group folds away, because the
 * list is the part that grows without limit — Recent is short by design, Saved
 * is however long it is, and the sample sits with them rather than in a banner
 * of its own. Recent and Saved are a partition rather than two views of one
 * list: a connection appears in exactly one of them, because the same
 * "localhost" in two sections a hundred pixels apart is a puzzle, not a
 * shortcut.
 */
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
import AppMark from '../components/ui/AppMark.vue';
import DisclosureGroup from '../components/ui/DisclosureGroup.vue';
import SettingsSheet from '../components/settings/SettingsSheet.vue';
import ShortcutSheet from '../components/settings/ShortcutSheet.vue';
import StorageSheet from '../components/settings/StorageSheet.vue';
import ProviderSheet from '../components/assistant/ProviderSheet.vue';
import { useConnections } from '../stores/connections';
import { useToasts } from '../stores/toasts';

/**
 * How many databases count as "recent".
 *
 * Short on purpose: the point of the section is that the one you want is
 * already on it, and a list long enough to search is the list below it.
 */
const RECENT_LIMIT = 4;

const connections = useConnections();
const toasts = useToasts();
const { t } = useTranslation();

const search = ref('');
const editing = ref<SavedConnection | null | undefined>(undefined);
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
const unfolded = ref<Record<string, boolean>>({ recent: true, saved: true, sample: true });

onMounted(() => void connections.refresh());

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

const recent = computed(() =>
  connections.saved
    .filter((connection) => connection.lastUsedAt !== null)
    .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
    .slice(0, RECENT_LIMIT)
);

const rest = computed(() => {
  const shown = new Set(recent.value.map((connection) => connection.id));
  return connections.saved
    .filter((connection) => !shown.has(connection.id))
    .sort((a, b) => a.name.localeCompare(b.name));
});

interface Group {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly SavedConnection[];
}

/**
 * The sections, in the order they are read.
 *
 * Searching collapses the partition into one list: with a query typed, "which
 * of these did I open recently" is no longer the question being asked.
 */
const groups = computed<Group[]>(() => {
  const sections = needle.value
    ? [
        {
          id: 'matches',
          title: t('start.matches'),
          rows: connections.saved.filter((connection) =>
            haystack(connection).includes(needle.value)
          ),
        },
      ]
    : [
        { id: 'recent', title: t('start.recent'), rows: recent.value },
        { id: 'saved', title: t('start.saved'), rows: rest.value },
      ];

  return sections.filter((section) => section.rows.length > 0);
});

const nothingMatches = computed(() => groups.value.length === 0);

/**
 * Searching opens whatever it found. A match hidden inside a folded group is
 * the same as no match at all.
 */
watch(needle, (value) => {
  if (!value) return;
  for (const group of groups.value) unfolded.value[group.id] = true;
});

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

/**
 * Writes one connection out as a preset, credentials and all.
 *
 * The point of a preset is that it moves a connection to another machine, and
 * one that arrives needing a password remembered is half a move. So the
 * secrets go with it.
 *
 * They are read here rather than in the document module, because the keyring
 * belongs to the main process and this is the one place with a reason to ask.
 * A connection with nothing stored exports a document with no `secrets` field
 * at all, and the note inside says which kind it is — as does the toast,
 * because a file that quietly contains a password is the one people attach to
 * a ticket.
 */
/**
 * Two ways out, on one control.
 *
 * A file is the way to move a connection to another machine; the clipboard is
 * the way to put one in a message to a colleague, and it was the more likely of
 * the two every time somebody wanted to *share* rather than to back up. A menu
 * rather than a second icon in the row, because they are one idea — take this
 * connection away with you — asked in two shapes.
 */
const exportMenu = ref(false);
const exportAt = ref<{ x: number; y: number }>({ x: 0, y: 0 });
const exportTrigger = ref<HTMLElement>();
const exporting = ref<SavedConnection | null>(null);

const exportItems = computed<MenuItem[]>(() => [
  { id: 'file', label: t('start.exportToFile'), icon: 'download' },
  { id: 'clipboard', label: t('start.exportToClipboard'), icon: 'copy' },
]);

function openExport(connection: SavedConnection, event: MouseEvent): void {
  exporting.value = connection;
  exportTrigger.value = event.currentTarget as HTMLElement;
  exportAt.value = { x: event.clientX, y: event.clientY };
  exportMenu.value = true;
}

function chooseExport(id: string): void {
  const connection = exporting.value;
  if (!connection) return;
  void (id === 'clipboard' ? copyConnection(connection) : exportConnection(connection));
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

  for (const input of result.connections) await connections.save(input);
  toasts.show({
    id: 'connection-import',
    tone: 'success',
    message: t('start.imported', { n: result.connections.length }),
  });
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
    await connections.connect(connection);
  } finally {
    opening.value = null;
  }
}

async function openSample(): Promise<void> {
  sampling.value = true;
  try {
    await connections.exploreSample();
  } finally {
    sampling.value = false;
  }
}

async function saved(connection: SavedConnection, connect: boolean): Promise<void> {
  editing.value = undefined;
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
  <div class="manager panel-content">
    <!-- What this is, and how to start something that is not on the list. -->
    <aside class="intro">
      <!--
        Traffic-light clearance and a surface to drag the window by, over this
        pane only: across the whole width it would sit on top of the list beside
        it and swallow the first inch of every scroll.
      -->
      <div class="intro__chrome drag-region" />
      <div class="intro__inner">
        <header class="identity" style="--step: 0">
          <AppMark class="identity__mark" />
          <h1 class="identity__title">
            {{ $t('app.name') }}
          </h1>
        </header>

        <div class="finder" style="--step: 1">
          <AppIcon class="finder__icon" name="search" :size="16" />

          <input
            v-model="search"
            class="finder__input"
            type="text"
            :placeholder="$t('start.search')"
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
          <button v-if="parsed" class="parsed" type="button" @click="useParsed">
            <span class="parsed__label">{{ $t('start.recognised') }}</span>
            <span class="parsed__name">{{ parsed.suggestedName }}</span>
            <span class="parsed__engine">{{ parsed.engine }}</span>
            <span class="parsed__go">{{ $t('start.setUp') }} ↩</span>
          </button>
        </Transition>

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

        <p v-if="!connections.keyringAvailable" class="keyring" style="--step: 3">
          {{ $t('start.noKeyring') }}
        </p>
      </div>
    </aside>

    <!--
      Everything there is to open. The one part of the screen that grows without
      limit, so it is the one part that scrolls.
    -->
    <section class="browser mat-regular panel-sidebar">
      <div class="browser__scroll">
        <DisclosureGroup
          v-for="(group, position) in groups"
          :key="group.id"
          v-model="unfolded[group.id]"
          :label="group.title"
          :hint="String(group.rows.length)"
          class="fold"
          :style="{ '--step': position }"
        >
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
                  :aria-label="$t('start.export', { name: connection.name })"
                  @click="openExport(connection, $event)"
                >
                  <AppIcon name="download" :size="16" />
                </button>
                <button
                  type="button"
                  class="rowaction"
                  :aria-label="$t('start.edit', { name: connection.name })"
                  @click="
                    seed = undefined;
                    editing = connection;
                  "
                >
                  <AppIcon name="pencil" :size="16" />
                </button>
                <button
                  type="button"
                  class="rowaction rowaction--danger"
                  :aria-label="$t('start.remove', { name: connection.name })"
                  @click="connections.remove(connection.id)"
                >
                  <AppIcon name="close" :size="16" />
                </button>
              </template>
            </LineupRow>
          </div>
        </DisclosureGroup>

        <p v-if="nothingMatches" class="blank">
          {{ needle ? $t('start.noMatches') : $t('start.nothingSaved') }}
        </p>

        <!--
          The sample sits with the databases rather than in a banner of its own.
          It is a real feature and not a demo hook: the same database backs the
          screenshots and the tests.
        -->
        <DisclosureGroup
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
      </div>
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
      v-model="exportMenu"
      :items="exportItems"
      :at="exportAt"
      :trigger="exportTrigger"
      @choose="chooseExport"
    />

    <ConnectionEditor
      v-if="editing !== undefined"
      :editing="editing"
      :seed="seed"
      :keyring-available="connections.keyringAvailable"
      @close="editing = undefined"
      @saved="saved"
    />
  </div>
</template>

<style scoped>
/*
 * Two panes: what this is on the left, what you can open on the right.
 *
 * The start screen paints a surface of its own. It used to paint nothing,
 * relying on the window being translucent — which works only for as long as
 * whatever is behind the window is dark. On the dark theme its text is light,
 * so over a bright desktop the title and the cards were light-on-light and
 * effectively invisible.
 *
 * Translucent still, so the window keeps its material — but no
 * `backdrop-filter` on it. There is nothing painted behind this screen to
 * filter: the glass is the OS's own material behind the whole window, which no
 * in-page filter can reach, so a blur here is a full-screen compositing pass a
 * frame producing exactly what not running it produces.
 */
.manager {
  position: relative;
  height: 100%;
  display: grid;
  /*
   * The golden section, with the larger part on the left.
   *
   * The left pane is the one you read — a name, a line about what this is, and
   * the field you type into — and the right is a list you scan. Giving the
   * reading side 1.618 of the scanning side is the oldest answer there is to
   * "how much bigger", and unlike the 1 : 1.1 it replaces it is a proportion
   * rather than a number that happened to look right in one window.
   */
  grid-template-columns: minmax(15rem, 1.618fr) minmax(16rem, 1fr);
  overflow: hidden;
  /*
   * The app's own materials, not a surface of this view's own.
   *
   * This painted `color-mix(base-100 86%)` — a number written here and nowhere
   * else, near enough to opaque that the window's glass had nothing left to
   * show through it. So the one screen that is *entirely* window, with the
   * desktop directly behind it, was the one screen with no vibrancy.
   *
   * It is the same two surfaces the workspace is made of instead: the reading
   * pane is the working surface and the list beside it is the sidebar's glass,
   * which means the welcome screen and the window it opens into are built from
   * the same materials, follow the same opacity dial, and go solid together
   * under `prefers-reduced-transparency`.
   */
}

@media (prefers-reduced-transparency: reduce) {
  .manager {
    background-color: var(--color-base-100);
  }
}

/*
 * One scale for both panes, taken from the size of the window.
 *
 * A start screen laid out at one fixed size is a small block adrift in the
 * middle of a large display — the window grows and the thing you came for does
 * not. Everything inside the panes is expressed in `em`, so rows, marks,
 * headings and the spacing between them grow together and the proportion
 * between the content and the window stays where it was designed. Both ends of
 * the clamp are in rem, so an enlarged OS text size still scales the layout
 * rather than being overridden by it.
 */
.intro,
.browser {
  font-size: clamp(0.8125rem, 0.35rem + 0.25vw + 0.65vh, 1.0625rem);
}

/* --- left: what this is ------------------------------------------------- */

.intro {
  position: relative;
  display: flex;
  min-width: 0;
  padding: calc(var(--titlebar-h) + var(--gap-section)) var(--gap-section) var(--gap-section);
}

.intro__chrome {
  position: absolute;
  inset-inline: 0;
  top: 0;
  height: var(--titlebar-h);
}

.intro__inner {
  width: 100%;
  max-width: 30em;
  margin: auto;
  display: flex;
  flex-direction: column;
}

/*
 * Everything arrives in the order it is read, one after another. Capped,
 * because a cascade long enough to notice is a wait.
 */
.identity,
.finder,
.intro__action,
.keyring,
.fold {
  animation: lift-in var(--t-panel) var(--ease-out) backwards;
  /*
   * Capped, the way the connection rows below already cap theirs.
   *
   * This is the first screen of every launch, and it used to finish arriving
   * about two thirds of a second in — 420ms of travel with 55ms between each
   * item, which compounds. The cascade is worth keeping and the wait is not, so
   * the step is shorter and the whole sequence is bounded rather than growing
   * with the number of things on screen.
   */
  animation-delay: min(calc(var(--step) * 40ms), 160ms);
}

@keyframes lift-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
}

/*
 * Spacing is declared by the thing above the gap rather than by one `gap` on
 * the column, so a row that is not drawn takes its own separation with it
 * instead of leaving a hole where it used to be.
 */
.identity,
.finder,
.parsed {
  margin-bottom: 1.5em;
}

.keyring {
  margin-top: 1.5em;
}

.identity {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

/*
 * The mark itself is `AppMark`; its place in this column is set here — and its
 * size, which is larger than the mark it replaced. That one was a glyph on a
 * tinted square and could afford to be small; this one is a drawing with three
 * things in it, and at the old size the shortest column was a few pixels wide.
 */
.identity__mark {
  /*
   * Wider than the mark looks, because a fifth of the artwork is the padding
   * macOS wants around an icon — the same file draws the dock tile, and the box
   * grows so the *drawing* stays the size the composition wants.
   */
  width: 6em;
  height: 6em;
  margin-bottom: 0.35em;
}

/* Large text wants negative tracking; at this size the default reads loose. */
.identity__title {
  font-size: 2.15em;
  font-weight: 650;
  letter-spacing: -0.028em;
  line-height: 1.1;
}

.finder {
  position: relative;
  display: flex;
  align-items: center;
  border-radius: 0.75em;
  background: var(--fill-4);
  border: 1px solid var(--separator);
  transition:
    border-color var(--t-hover) var(--ease-out),
    box-shadow var(--t-hover) var(--ease-out),
    background-color var(--t-hover) var(--ease-out);
}

.finder:focus-within {
  background: var(--fill-3);
  border-color: color-mix(in oklab, var(--color-primary) 55%, transparent);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-primary) 16%, transparent);
}

.finder__icon {
  width: 1em;
  height: 1em;
  margin-inline-start: 0.75em;
  color: var(--text-soft);
}

.finder__input {
  flex: 1;
  min-width: 0;
  height: max(var(--hit-min), 2.5em);
  padding-inline: 0.6em;
  border: 0;
  background: transparent;
  color: var(--color-base-content);
  font-size: 0.95em;
}

/* The wrapper owns the focus ring; the input drawing its own gives two. */
.finder__input:focus,
.finder__input:focus-visible {
  outline: none;
}

.finder__input::placeholder {
  color: var(--text-soft);
}

.finder__clear {
  display: grid;
  place-items: center;
  width: max(var(--hit-min), 1.8em);
  height: max(var(--hit-min), 1.8em);
  margin-inline-end: 0.35em;
  border-radius: 999px;
  color: var(--text-soft);
  transition: background-color var(--t-press) var(--ease-out);
}

.finder__clear .icon {
  width: 0.7em;
  height: 0.7em;
}

.parsed {
  display: flex;
  align-items: center;
  gap: 0.5em;
  padding: 0.5em 0.75em;
  border-radius: 0.75em;
  border: 1px solid color-mix(in oklab, var(--color-primary) 40%, transparent);
  background: color-mix(in oklab, var(--color-primary) 10%, transparent);
  text-align: start;
  transition: background-color var(--t-hover) var(--ease-out);
}

.parsed__label {
  font-size: 0.6em;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-primary-text, var(--color-primary));
}

.parsed__name {
  font-family: var(--font-mono);
  font-size: 0.75em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.parsed__engine {
  padding: 1px 7px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--color-primary) 22%, transparent);
  font-size: 0.6em;
}

.parsed__go {
  margin-inline-start: auto;
  font-size: 0.7em;
  color: var(--color-primary-text, var(--color-primary));
  white-space: nowrap;
}

/* --- right: what there is to open --------------------------------------- */

/*
 * The second tone, and the whole reason the split reads as two places rather
 * than one page with a rule down it. The left pane is the window's own surface;
 * this one is a step back from it, so the list on it needs no card of its own to
 * be a list — a border and the hairlines between the rows are enough.
 */
.browser {
  display: flex;
  min-width: 0;
  border-inline-start: 1px solid var(--separator);
}

.browser__scroll {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: calc(var(--titlebar-h) + var(--gap)) var(--gap-section) var(--gap-section);
}

.fold + .fold {
  margin-top: 0.9em;
}

/* One object per group, with the rows ruled inside it. */
.group__list {
  border-radius: 0.9em;
  border: 1px solid var(--separator);
  overflow: hidden;
}

/* The one thing to start on this side, as a filled row rather than an outlined
   one: it is an action, and the groups opposite are a list. */
.intro__action {
  border-radius: 0.9em;
  background: var(--fill-3);
  overflow: hidden;
}

.group__list > :deep(* + *),
.intro__action > :deep(* + *) {
  border-top: 1px solid var(--separator);
}

.group__row {
  animation: lift-in var(--t-sheet) var(--ease-out) backwards;
  animation-delay: min(calc(var(--index) * 35ms), 280ms);
}

/*
 * A row's own actions.
 *
 * Sized well above the pointer floor rather than at it: they appear on hover
 * over a row whose whole width is also a target, so the two have to be told
 * apart by eye at a glance, and a 28px square carrying a 10px glyph reads as a
 * speck rather than a button.
 */
.rowaction {
  display: grid;
  place-items: center;
  width: max(var(--hit-min), 2.4em);
  height: max(var(--hit-min), 2.4em);
  border-radius: 0.55em;
  color: var(--text-soft);
  transition:
    background-color var(--t-press) var(--ease-out),
    color var(--t-press) var(--ease-out);
}

.rowaction .icon {
  width: 1.15em;
  height: 1.15em;
}

.flag {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--color-warning) 26%, transparent);
  font-size: 0.65em;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.blank {
  padding: 1.5em 0;
  text-align: center;
  font-size: 0.85em;
  color: var(--text-soft);
}

.keyring {
  text-align: center;
  font-size: 0.8em;
  color: color-mix(in oklab, var(--color-warning) 90%, var(--color-base-content));
}

/* Enter and exit along the same path, so the two read as one movement. */
.rise-enter-active,
.rise-leave-active {
  transition:
    opacity var(--t-pop) var(--ease-out),
    transform var(--t-pop) var(--ease-out);
}

.rise-enter-from,
.rise-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (hover: hover) and (pointer: fine) {
  .finder__clear:hover {
    background: var(--fill-2);
    color: var(--color-base-content);
  }

  .parsed:hover {
    background: color-mix(in oklab, var(--color-primary) 16%, transparent);
  }

  .rowaction:hover {
    background: var(--fill-1);
    color: var(--color-base-content);
  }

  .rowaction--danger:hover {
    background: var(--color-error);
    color: var(--color-error-content);
  }
}

@media (prefers-reduced-motion: reduce) {
  .identity,
  .finder,
  .intro__action,
  .keyring,
  .fold,
  .group__row {
    animation: none;
  }

  .rise-enter-from,
  .rise-leave-to {
    transform: none;
  }
}
</style>
