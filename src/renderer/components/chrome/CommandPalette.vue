<script setup lang="ts">
/**
 * The quick action bar.
 *
 * One field with two modes, and the glyph at its left says which. Typed at
 * plainly it finds tables; a leading `/` turns it into a command list. That was
 * the sibling project's idea and its best detail is the glyph: without it the
 * field looked identical in both modes while behaving nothing alike.
 *
 * Finding a table takes a path or a pattern — `music.album`, `^a.*t$` — which
 * is why the sidebar no longer carries a filter box. Narrowing a tree in place
 * only ever showed you what you already had open; this reaches the whole
 * database and opens what you pick.
 *
 * **It does not animate, and that is the point.** It opened on a 280ms rise and
 * a fade, which is a perfectly nice animation on a surface nobody reaches for
 * fifty times a day. This one is reached from the keyboard, and an animation on
 * a keyboard action is a delay between the keystroke and a field the reader is
 * already typing into — every time, forever. Raycast has no open or close
 * animation at all; that is the standard being matched here rather than a
 * corner being cut. The correct duration for this surface is zero, so there is
 * no `<Transition>` to shorten.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useDismiss } from '../../composables/useDismiss';
import type { Entity } from '@drivers/types';
import { qualifiedPath, scoreEntity, parseQuery, leafOf } from '@shared/entitySearch';
import { useTranslation } from 'i18next-vue';
import { buildCommands, matchSlash, type Command } from '../../lib/commands';
import { useConnections } from '../../stores/connections';
import { useEntities } from '../../stores/entities';
import { useSettings } from '../../stores/settings';
import { useUpdates } from '../../stores/updates';
import { useTabs } from '../../stores/tabs';
import { useTheme } from '../../composables/useTheme';
import AppIcon from '../ui/AppIcon.vue';

const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{
  openSettings: [];
  openShortcuts: [];
  openStorage: [];
  newConnection: [];
  diagnose: [];
  resetSidebar: [];
}>();

const connections = useConnections();
const entities = useEntities();
const settings = useSettings();
const updates = useUpdates();
const tabs = useTabs();
const theme = useTheme();
const { t } = useTranslation();

const query = ref('');
const selected = ref(0);
const input = ref<HTMLInputElement>();
const list = ref<HTMLElement>();

/** A leading slash is the mode switch, and the only one. */
const commandMode = computed(() => query.value.startsWith('/'));

/* ------------------------------------------------------------- what it can do */

const navigation = computed<Command[]>(() => [
  {
    id: 'nav.new-query',
    section: 'navigation',
    icon: 'query',
    title: t('palette.newQuery'),
    slash: '/query new',
    keywords: 'tab editor sql',
    run: () => tabs.openQuery(),
  },
  {
    /*
     * The assistant lost its button beside the new-tab plus, which was one
     * glyph too many in a bar that is mostly window chrome. It keeps a
     * shortcut, a place in every table's menu, and this — a palette row is
     * where an action with no permanent home is supposed to live.
     */
    id: 'nav.new-chat',
    section: 'navigation',
    icon: 'assistant',
    title: t('palette.newChat'),
    slash: '/chat new',
    keywords: 'assistant ai ask question sql',
    run: () => tabs.openChat(),
  },
  {
    id: 'nav.diagram',
    section: 'navigation',
    icon: 'diagram',
    title: t('palette.openDiagram'),
    slash: '/diagram',
    keywords: 'erd relationships',
    run: () => tabs.openErd(),
  },
  {
    id: 'nav.refresh',
    section: 'navigation',
    icon: 'refresh',
    title: t('palette.refreshSchema'),
    slash: '/refresh',
    keywords: 'reload schema tables',
    run: () => void entities.refresh(),
  },
  {
    id: 'nav.settings',
    section: 'navigation',
    icon: 'settings',
    title: t('action.settings'),
    slash: '/settings',
    keywords: 'preferences options',
    run: () => emit('openSettings'),
  },
  {
    id: 'nav.shortcuts',
    section: 'navigation',
    icon: 'keyboard',
    title: t('settings.keyboard'),
    slash: '/shortcuts',
    keywords: 'keys keyboard bindings keymap accelerator',
    run: () => emit('openShortcuts'),
  },
  {
    /*
     * A check, not a place — so it runs rather than emitting.
     *
     * The other rows here hand a sheet to the view that owns it. Nothing owns
     * this one: the update prompt is mounted beside the toasts, above both
     * views, because what it has to say outlives which screen you are on. So
     * the row calls the flow directly, exactly as the settings button does.
     */
    id: 'nav.updates',
    section: 'navigation',
    icon: 'download',
    title: t('update.checkNow'),
    slash: '/update',
    keywords: 'version release upgrade newer build download',
    run: () => void updates.check(),
  },
  {
    id: 'nav.storage',
    section: 'navigation',
    icon: 'database',
    title: t('storage.title'),
    slash: '/storage',
    keywords: 'clear delete cache history chats jobs disk space',
    run: () => emit('openStorage'),
  },
  {
    id: 'nav.newConnection',
    section: 'navigation',
    icon: 'plus',
    title: t('connection.new'),
    slash: '/connection new',
    keywords: 'database add server',
    run: () => emit('newConnection'),
  },
  {
    id: 'nav.diagnose',
    section: 'navigation',
    icon: 'chart',
    title: t('diagnose.action'),
    slash: '/diagnose',
    keywords: 'connection health latency ping round trip',
    run: () => emit('diagnose'),
  },
  {
    id: 'nav.collapse',
    section: 'navigation',
    icon: 'arrowsIn',
    title: t('action.collapseAll'),
    slash: '/collapse',
    keywords: 'sidebar tree folders',
    run: () => entities.collapseAll(),
  },
  {
    id: 'nav.expand',
    section: 'navigation',
    icon: 'arrowsOut',
    title: t('action.expandAll'),
    slash: '/expand',
    keywords: 'sidebar tree folders open',
    run: () => entities.expandAll(),
  },
  /*
   * The switch in the sidebar is drawn only for engines that have built-ins;
   * this row is offered on the same terms, because a command that runs and
   * changes nothing is worse than one that is not there.
   */
  ...(connections.active?.capabilities.builtInEntities
    ? [
        {
          id: 'nav.builtIns',
          section: 'navigation' as const,
          icon: 'tables',
          title: entities.showBuiltIns
            ? t('workspace.builtInsHide')
            : t('workspace.builtInsShow'),
          slash: '/built-ins',
          keywords: 'catalogue extension system functions tables sidebar',
          run: () => {
            entities.showBuiltIns = !entities.showBuiltIns;
          },
        },
      ]
    : []),
  {
    id: 'nav.resetSidebar',
    section: 'navigation',
    icon: 'sidebar',
    title: t('workspace.resetSidebar'),
    slash: '/sidebar-reset',
    keywords: 'sidebar width reset default size column',
    run: () => emit('resetSidebar'),
  },
  {
    id: 'nav.disconnect',
    section: 'navigation',
    icon: 'close',
    title: t('palette.disconnectFrom', { name: connections.active?.name ?? '' }),
    slash: '/disconnect',
    keywords: 'close connection',
    run: () => void connections.disconnect(),
  },
]);

const commands = computed(() =>
  buildCommands({ theme, settings, navigation: navigation.value })
);

/**
 * Commands, matched by the mode the field is in.
 *
 * `/` gives the whole registry, matched against the typed forms. Plain text
 * matches them too, by title and keywords, because "settings" was findable by
 * typing "sett" long before there was a slash mode — a palette that quietly
 * stops answering the words people already use has got worse, not stricter.
 */
const matchedCommands = computed(() => {
  if (commandMode.value) {
    return commands.value.filter((command) => matchSlash(command, query.value));
  }

  const needle = query.value.trim().toLowerCase();
  if (needle === '') return [];

  return commands.value.filter((command) =>
    `${command.title} ${command.keywords ?? ''}`.toLowerCase().includes(needle)
  );
});

/* ---------------------------------------------------------------- the tables */

interface Hit {
  readonly entity: Entity;
  readonly path: string;
  readonly score: number;
}

const database = computed(() => connections.active?.database ?? undefined);

const matchedTables = computed<Hit[]>(() => {
  if (commandMode.value) return [];

  const parsed = parseQuery(query.value);
  const hits: Hit[] = [];

  for (const entity of entities.entities) {
    const searchable = {
      name: entity.name,
      schema: entity.schema,
      database: database.value,
    };
    const score = scoreEntity(searchable, parsed);
    if (score === null) continue;
    hits.push({ entity, path: qualifiedPath(searchable), score });
  }

  return hits.sort((a, b) => b.score - a.score);
});

/**
 * How many rows are drawn, and how many were found.
 *
 * A cap is needed — a schema of fifty thousand tables is one `v-for` away from
 * a locked window — but it has to be stated. It was a silent `slice(0, 40)`
 * under a heading that then counted the survivors, so a database of a hundred
 * and eighty tables opened the palette and announced it had forty.
 */
const RENDER_LIMIT = 200;

const shownTables = computed(() => matchedTables.value.slice(0, RENDER_LIMIT));
const truncated = computed(() => matchedTables.value.length - shownTables.value.length);

/**
 * Where the table actually is, when the path given for it was wrong.
 *
 * `orders` finding a table and `warehouse.public.orders` finding nothing is a
 * confusing pair to be handed with no explanation — the obvious reading is that
 * dot notation is broken, when what has happened is that one of the levels
 * above is not spelt the way it was guessed. So when a path query comes back
 * empty, the leaf is searched on its own and the results are offered as the
 * paths that do exist. It answers the question the empty state raises.
 */
const elsewhere = computed<string[]>(() => {
  if (matchedTables.value.length > 0) return [];

  const leaf = leafOf(parseQuery(query.value));
  if (leaf === undefined) return [];

  const alone = parseQuery(leaf);
  const paths: string[] = [];

  for (const entity of entities.entities) {
    const searchable = {
      name: entity.name,
      schema: entity.schema,
      database: database.value,
    };
    if (scoreEntity(searchable, alone) === null) continue;
    paths.push(qualifiedPath(searchable));
    if (paths.length === 5) break;
  }

  return paths;
});

/*
 * Open tabs, offered only on an empty query. "Where was I" is the useful answer
 * to a palette that has just been opened and the useless one to a palette that
 * has been typed into.
 */
const openTabs = computed(() =>
  query.value.trim() === ''
    ? tabs.tabs.map((tab) => ({ id: tab.id, title: tab.title, subtitle: tab.subtitle }))
    : []
);

/**
 * Every row, in the order they are drawn.
 *
 * One flat list behind the sections, so the arrow keys move through the palette
 * rather than through whichever group they happen to be in.
 */
type Row =
  | { kind: 'command'; command: Command }
  | { kind: 'table'; hit: Hit }
  | { kind: 'tab'; id: string; title: string; subtitle?: string | undefined };

/*
 * Tables first when they were what was asked for. The field's plain mode is a
 * table search that also answers command words, not a command list that happens
 * to include tables, and the first row is the one Enter runs.
 */
const rows = computed<Row[]>(() =>
  commandMode.value
    ? matchedCommands.value.map((command) => ({ kind: 'command' as const, command }))
    : [
        ...openTabs.value.map((tab) => ({ kind: 'tab' as const, ...tab })),
        ...shownTables.value.map((hit) => ({ kind: 'table' as const, hit })),
        ...matchedCommands.value.map((command) => ({ kind: 'command' as const, command })),
      ]
);

/**
 * The same rows, grouped for display.
 *
 * Sections are derived from the flat list rather than rendered from three
 * separate arrays, so a row's position in the keyboard order is the position it
 * reports. Each section computing its own offset is a sum that was already
 * wrong once, the moment the order stopped being fixed.
 */
const sections = computed(() => {
  const groups: { key: string; label: string; items: { row: Row; index: number }[] }[] = [];

  rows.value.forEach((row, index) => {
    const key = row.kind === 'table' ? 'tables' : row.kind === 'tab' ? 'tabs' : 'commands';
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push({ row, index });
    else
      groups.push({
        key,
        label:
          key === 'tables'
            ? t('commands.sectionTables')
            : key === 'tabs'
              ? t('palette.openTabs')
              : t('commands.sectionCommands'),
        items: [{ row, index }],
      });
  });

  return groups;
});

watch(rows, () => (selected.value = 0));

/**
 * Keeps the caret in the field for as long as the palette is up.
 *
 * A modal that does not hold focus is worse than no modal: the palette was over
 * the query editor and the editor still had the caret, so what was typed went
 * into the SQL behind it and the list never moved. Focusing once on open was
 * not enough, because Monaco takes focus back — it re-focuses itself on layout,
 * and its edit context keeps routing keystrokes until something else genuinely
 * holds the caret.
 *
 * So the guard is a capture listener rather than a single call: any key that
 * arrives anywhere but inside the palette is a key the palette should have had,
 * and it is stopped and the field re-focused rather than delivered to whatever
 * is underneath.
 */
useDismiss(open);

function guardKey(event: KeyboardEvent): void {
  const field = input.value;
  if (!field || event.target === field) return;
  if (field.contains(event.target as Node)) return;

  event.stopPropagation();
  field.focus();
}

watch(open, async (isOpen) => {
  if (!isOpen) {
    window.removeEventListener('keydown', guardKey, true);
    return;
  }

  query.value = '';
  selected.value = 0;
  await nextTick();
  input.value?.focus();
  window.addEventListener('keydown', guardKey, true);
});

onBeforeUnmount(() => window.removeEventListener('keydown', guardKey, true));

/**
 * How many rows a page is — measured, not guessed.
 *
 * A list with a section heading every few entries has no single row height to
 * divide by, so the count comes from the rows that are actually on screen. One
 * fewer than fits, because a page that leaves nothing behind gives the reader
 * no thread back to where they were.
 */
function page(): number {
  const box = list.value;
  const row = box?.querySelector<HTMLElement>('[data-index]');
  if (!box || !row) return 1;

  return Math.max(1, Math.floor(box.clientHeight / row.offsetHeight) - 1);
}

/** Straight to an end, without walking the rows in between. */
function jump(index: number): void {
  if (rows.value.length === 0) return;
  move(index - selected.value);
}

function move(delta: number): void {
  const count = rows.value.length;
  if (count === 0) return;

  /*
   * One step wraps, a jump does not. Arrowing past the last row and arriving at
   * the first is a shortcut people use on purpose; a page down that silently
   * lands you at the top has lost your place rather than moved it.
   */
  selected.value =
    Math.abs(delta) === 1
      ? (selected.value + delta + count) % count
      : Math.min(count - 1, Math.max(0, selected.value + delta));

  void nextTick(() => {
    list.value
      ?.querySelector(`[data-index="${selected.value}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  });
}

function choose(row: Row): void {
  open.value = false;

  if (row.kind === 'command') row.command.run();
  else if (row.kind === 'tab') tabs.focus(row.id);
  else {
    const entity = row.hit.entity;
    tabs.openEntity('table', {
      name: entity.name,
      ...(entity.schema ? { schema: entity.schema } : {}),
    });
  }
}

function commit(): void {
  const row = rows.value[selected.value];
  if (row) choose(row);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="scrim"
      role="dialog"
      aria-modal="true"
      :aria-label="$t('palette.label')"
      @click.self="open = false"
    >
      <div class="palette surface-sheet mat-edge-top">
        <div class="palette__field">
          <!--
            The glyph is the mode. A chevron for commands, a magnifier for
            tables — drawn in the same stroke weight, because the field has
            not become a different control, only a different mode of one.
          -->
          <AppIcon
            class="palette__glyph"
            :class="{ 'palette__glyph--command': commandMode }"
            :name="commandMode ? 'chevron' : 'search'"
            :size="15"
          />

          <input
            ref="input"
            v-model="query"
            class="palette__input"
            type="text"
            :placeholder="
              commandMode ? $t('commands.commandPlaceholder') : $t('commands.placeholder')
            "
            spellcheck="false"
            autocomplete="off"
            role="combobox"
            aria-controls="palette-results"
            aria-autocomplete="list"
            :aria-expanded="rows.length > 0"
            :aria-activedescendant="rows.length ? `palette-option-${selected}` : undefined"
            @keydown.down.prevent="move(1)"
            @keydown.up.prevent="move(-1)"
            @keydown.page-down.prevent="move(page())"
            @keydown.page-up.prevent="move(-page())"
            @keydown.home.prevent="jump(0)"
            @keydown.end.prevent="jump(rows.length - 1)"
            @keydown.enter.prevent="commit"
          />

          <button
            v-if="query"
            type="button"
            class="palette__clear focus-fill"
            :aria-label="$t('action.clear')"
            @click="
              query = '';
              input?.focus();
            "
          >
            <AppIcon name="close" :size="11" />
          </button>

          <kbd class="palette__key">esc</kbd>
        </div>

        <div
          v-if="rows.length"
          id="palette-results"
          ref="list"
          class="palette__list"
          role="listbox"
        >
          <template v-for="section in sections" :key="section.key">
            <p class="palette__section type-label">
              {{ section.label }} ·
              {{
                section.key === 'tables' && truncated > 0
                  ? $t('commands.someOf', {
                      shown: section.items.length,
                      total: matchedTables.length,
                    })
                  : section.items.length
              }}
            </p>

            <div
              v-for="entry in section.items"
              :id="`palette-option-${entry.index}`"
              :key="entry.index"
              class="palette__row"
              :class="{ 'palette__row--on': entry.index === selected }"
              :data-index="entry.index"
              role="option"
              :aria-selected="entry.index === selected"
              @mouseenter="selected = entry.index"
              @click="choose(entry.row)"
            >
              <template v-if="entry.row.kind === 'command'">
                <span
                  v-if="entry.row.command.swatch"
                  class="palette__swatch"
                  :style="{ background: entry.row.command.swatch }"
                />
                <AppIcon
                  v-else
                  class="palette__icon"
                  :name="entry.row.command.icon"
                  :size="13"
                />
                <span class="palette__label">{{ entry.row.command.title }}</span>
                <span class="palette__slash">{{ entry.row.command.slash }}</span>
              </template>

              <template v-else-if="entry.row.kind === 'tab'">
                <AppIcon class="palette__icon" name="query" :size="13" />
                <span class="palette__label">{{ entry.row.title }}</span>
                <span class="palette__slash">{{ entry.row.subtitle }}</span>
              </template>

              <template v-else>
                <AppIcon class="palette__icon" name="table" :size="13" />
                <!-- The qualifier is dimmed and the name is not: the path is
                     there to disambiguate, not to be read. -->
                <span class="palette__label">
                  <span class="palette__qualifier">{{
                    entry.row.hit.path.slice(
                      0,
                      entry.row.hit.path.length - entry.row.hit.entity.name.length
                    )
                  }}</span
                  >{{ entry.row.hit.entity.name }}
                </span>
                <span class="palette__slash">{{ entry.row.hit.entity.kind }}</span>
              </template>
            </div>
          </template>
        </div>

        <div v-else class="palette__empty">
          <p>{{ query ? $t('commands.nothing') : $t('palette.openSomething') }}</p>

          <!-- The path was wrong, not the search. Here is the right one. -->
          <template v-if="elsewhere.length > 0">
            <p class="palette__aside">
              {{ $t('commands.tryPath') }}
            </p>
            <ul class="palette__paths">
              <li v-for="path of elsewhere" :key="path">
                <button type="button" class="palette__path" @click="query = path">
                  {{ path }}
                </button>
              </li>
            </ul>
          </template>
        </div>

        <div class="palette__foot type-label">
          <span><kbd class="palette__key">↵</kbd> {{ $t('commands.openHint') }}</span>
          <span><kbd class="palette__key">/</kbd> {{ $t('commands.commandHint') }}</span>
          <span class="palette__hint">{{ $t('commands.hintPath') }}</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: grid;
  place-items: start center;
  padding-top: 14vh;
}

.palette {
  width: min(38rem, calc(100vw - 4rem));
  border-radius: 1rem;
  overflow: hidden;
  box-shadow:
    0 1px 2px oklch(0% 0 0 / 0.08),
    0 24px 64px oklch(0% 0 0 / 0.28);
}

.palette__field {
  display: flex;
  align-items: center;
  gap: var(--gap);
  padding-inline: var(--gap-loose);
  height: 3rem;
}

.palette__glyph {
  flex: 0 0 auto;
  color: var(--text-soft);
  transition: color var(--t-hover) var(--ease-out);
}

.palette__glyph--command {
  color: var(--color-primary-text, var(--color-primary));
}

.palette__input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--color-base-content);
  font-size: 0.9375rem;
}

/* The field is the only focusable thing here and the ring would be clipped by
   the panel's own rounding, drawing as a line across it. */
.palette__input:focus-visible {
  outline: none;
}

.palette__input::placeholder {
  color: var(--text-soft);
}

.palette__clear {
  display: grid;
  place-items: center;
  width: var(--hit-min);
  height: var(--hit-min);
  border-radius: 999px;
  color: var(--text-soft);
}

.palette__key {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--fill-4);
  font-family: var(--font-ui);
  font-size: 0.625rem;
  color: var(--text-soft);
}

/*
 * The keyboard scrolls with something in front of it.
 *
 * `scrollIntoView({ block: 'nearest' })` moves the least it can get away with,
 * which puts the row you just selected hard against the edge it came from —
 * with the next one still hidden, and, at the top, under the section heading
 * that names what you are looking at. Arrowing through a long list then feels
 * like reading through a slot: the selection is always at the boundary and you
 * never see where you are going.
 *
 * `scroll-padding` is what that method reads to decide where "visible" starts
 * and ends. Two rows' worth at each end means selecting the last visible row
 * brings the next two up behind it, so the list moves ahead of the selection
 * rather than behind it. The mouse never had this problem, because a scroll
 * wheel moves the view and the eye picks the row.
 */
.palette__list {
  max-height: 24rem;
  overflow-y: auto;
  overscroll-behavior: contain;
  scroll-padding-block: 3.25rem;
  border-top: 1px solid var(--separator);
  padding: var(--gap-tight) var(--gap-tight) var(--gap);
}

.palette__section {
  padding: var(--gap) var(--gap) var(--gap-hair);
  color: var(--text-soft);
  text-transform: uppercase;
}

.palette__section:first-child {
  padding-top: var(--gap-tight);
}

.palette__row {
  display: flex;
  align-items: center;
  gap: var(--gap);
  height: var(--hit-min);
  padding-inline: var(--gap);
  border-radius: var(--radius-field);
  font-size: 0.8125rem;
}

.palette__row--on {
  background: color-mix(in oklab, var(--color-primary) 16%, transparent);
  color: var(--color-primary-text, var(--color-primary));
}

.palette__icon {
  flex: 0 0 auto;
  opacity: 0.65;
}

.palette__swatch {
  flex: 0 0 auto;
  width: 0.8125rem;
  height: 0.8125rem;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px oklch(0% 0 0 / 0.15);
}

.palette__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette__qualifier {
  color: color-mix(in oklab, currentColor 45%, transparent);
}

.palette__slash {
  flex: 0 0 auto;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: color-mix(in oklab, currentColor 45%, transparent);
}

.palette__aside {
  margin-block-start: var(--gap-tight);
  color: var(--text-soft);
}

.palette__paths {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  margin-block-start: var(--gap-tight);
}

.palette__path {
  padding: 2px var(--gap-tight);
  border-radius: var(--radius-field);
  color: var(--color-primary-text);
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.palette__path:hover {
  background: var(--fill-1);
}

.palette__empty {
  padding: var(--gap-section);
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-soft);
  border-top: 1px solid var(--separator);
}

/*
 * The footer says what the field can do before it has been used. A palette
 * whose second mode is only discoverable by accidentally typing a slash has a
 * second mode nobody finds.
 */
.palette__foot {
  display: flex;
  align-items: center;
  gap: var(--gap-loose);
  padding: var(--gap-tight) var(--gap-loose);
  border-top: 1px solid var(--separator);
  background: var(--fill-4);
  color: var(--text-soft);
}

.palette__hint {
  margin-inline-start: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
}
</style>
