<script setup lang="ts">
/**
 * The entity list.
 *
 * Rows are virtualised over the flattened tree the store produces, so a schema
 * with tens of thousands of tables scrolls as smoothly as one with ten. Only
 * the rows in view exist in the DOM; expansion state lives in the store rather
 * than in the row components, which are destroyed as they scroll away.
 */
import ProgressBar from '../ui/ProgressBar.vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { CellValue, Entity, EntityRef, Field } from '@drivers/types';
import { useTranslation } from 'i18next-vue';
import AppIcon from '../ui/AppIcon.vue';
import ContextMenu, { type MenuItem } from '../ui/ContextMenu.vue';
import ExportSheet from '../grid/ExportSheet.vue';
import QuickDocsSheet from '../tabs/QuickDocsSheet.vue';
import TablePropertiesSheet from '../tabs/TablePropertiesSheet.vue';
import { host } from '../../lib/host';
import { useConnections } from '../../stores/connections';
import { useEntities, type TreeRow } from '../../stores/entities';
import { useTabs } from '../../stores/tabs';
import { useToasts } from '../../stores/toasts';

const entities = useEntities();
const connections = useConnections();
const tabs = useTabs();
const toasts = useToasts();
const { t } = useTranslation();

const viewport = ref<HTMLElement>();
const scrollTop = ref(0);

/**
 * How tall a row actually is, measured rather than assumed.
 *
 * It was a hardcoded 24 with a comment promising it would be re-read on mount,
 * and nothing ever read it. A row is `--sidebar-row-h`, which floors at the 28px
 * hit target — so the spacer that gives the list its scroll height was sized at
 * six sevenths of the real content. Scrolling stopped at about 86% and snapped
 * back, on every tree long enough to scroll.
 *
 * Measured from a probe rather than from a rendered row: rows are recycled as
 * the window moves, and an observer bound to one of them would be watching an
 * element that gets replaced. The probe is one element whose only job is to be
 * the height of a row, so density and text-size changes are picked up for free.
 */
const rowHeight = ref(28);
const probe = ref<HTMLElement>();
/** Rows rendered beyond the viewport, so fast scrolling does not show gaps. */
const OVERSCAN = 8;

const total = computed(() => entities.rows.length);

const window = computed(() => {
  const height = viewport.value?.clientHeight ?? 600;
  const first = Math.max(0, Math.floor(scrollTop.value / rowHeight.value) - OVERSCAN);
  const visible = Math.ceil(height / rowHeight.value) + OVERSCAN * 2;
  return { first, last: Math.min(total.value, first + visible) };
});

const slice = computed(() => entities.rows.slice(window.value.first, window.value.last));

function onScroll(event: Event): void {
  scrollTop.value = (event.target as HTMLElement).scrollTop;
}

function measureRow(): void {
  const height = probe.value?.offsetHeight ?? 0;
  if (height > 0) rowHeight.value = height;
}

let probeObserver: ResizeObserver | undefined;

onMounted(() => {
  measureRow();
  probeObserver = new ResizeObserver(measureRow);
  if (probe.value) probeObserver.observe(probe.value);
});

onBeforeUnmount(() => {
  probeObserver?.disconnect();
  probeObserver = undefined;
});

/**
 * One click opens whatever the row is.
 *
 * A folder row and a table row behave the same way — the difference is only
 * what is inside them — so the tree does not ask the reader to remember which
 * kind of thing needs which gesture.
 */
function activate(row: TreeRow): void {
  if (row.groupKey) {
    entities.toggleGroup(row.groupKey);
    return;
  }
  if (row.entity) entities.toggle(row.entity);
}

/** Folders and tables open; columns and notes are leaves. */
function opens(row: TreeRow): boolean {
  return row.groupKey !== undefined || row.kind === 'entity';
}

function refOf(entity: Entity) {
  return { name: entity.name, ...(entity.schema ? { schema: entity.schema } : {}) };
}

function open(entity: Entity): void {
  if (entity.kind === 'routine') return;
  tabs.openEntity('table', refOf(entity));
}

/* ------------------------------------------------------------- the menu */

/**
 * One menu, from two doors.
 *
 * Right-click is where a desktop user looks first; the button is there because
 * a menu with no visible affordance is a menu most people never find. Both open
 * the same list at the same point, so there is nothing to learn twice.
 *
 * It replaces a lone icon that appeared on hover at the end of the row and
 * opened a whole tab. One hidden target, one destination — where four actions
 * belonged.
 */
const menuOpen = ref(false);
const menuAt = ref({ x: 0, y: 0 });
const menuEntity = ref<Entity | null>(null);

const propertiesOf = ref<EntityRef | null>(null);
const propertiesOpen = ref(false);
const docsOf = ref<EntityRef | null>(null);
const docsOpen = ref(false);
const exportOf = ref<EntityRef | null>(null);
const exportOpen = ref(false);

const menuItems = computed<MenuItem[]>(() => [
  { id: 'copy', label: t('menu.copyName'), icon: 'copy' },
  { id: 'docs', label: t('menu.quickDocs'), icon: 'info', startsGroup: true },
  { id: 'properties', label: t('menu.properties'), icon: 'structure' },
  { id: 'export', label: t('menu.exportData'), icon: 'download', startsGroup: true },
]);

function openMenu(event: MouseEvent, entity: Entity | undefined): void {
  if (!entity) return;
  event.preventDefault();
  menuEntity.value = entity;
  menuAt.value = { x: event.clientX, y: event.clientY };
  menuOpen.value = true;
}

function qualified(entity: Entity): string {
  return entity.schema ? `${entity.schema}.${entity.name}` : entity.name;
}

function onChoose(id: string): void {
  const entity = menuEntity.value;
  if (!entity) return;
  const ref_ = refOf(entity);

  if (id === 'copy') {
    const name = qualified(entity);
    void navigator.clipboard.writeText(name);
    toasts.show({ tone: 'success', message: t('menu.copiedName', { name }) });
    return;
  }
  if (id === 'docs') {
    docsOf.value = ref_;
    docsOpen.value = true;
    return;
  }
  if (id === 'properties') {
    propertiesOf.value = ref_;
    propertiesOpen.value = true;
    return;
  }
  if (id === 'export') {
    exportOf.value = ref_;
    exportOpen.value = true;
  }
}

/**
 * The host streams the whole table to the file, so this never loads a row into
 * the interface. The sheet's clipboard side is unavailable for the same reason
 * — there is nothing on screen to copy — and it says so rather than offering it.
 */
async function writeEntityToFile(
  path: string,
  format: 'csv' | 'json' | 'jsonl' | 'sql'
): Promise<void> {
  if (!exportOf.value) return;
  await host.call('export/run', {
    connectionId: connections.requireId(),
    path,
    format,
    entity: exportOf.value,
  });
}

const NO_ROWS: readonly Record<string, CellValue>[] = [];
const NO_FIELDS: readonly Field[] = [];

const KIND_ICON: Record<string, string> = {
  table: 'table',
  collection: 'table',
  view: 'view',
  'materialized-view': 'view',
  routine: 'routine',
};
</script>

<template>
  <div
    ref="viewport"
    class="tree"
    @scroll="onScroll"
  >
    <!--
      One row's worth of height, measured and never seen. The virtualiser needs
      the real number to size its spacer, and the alternative — reading it off a
      rendered row — is watching an element the recycler will replace.
    -->
    <div
      ref="probe"
      class="tree__probe"
      aria-hidden="true"
    />

    <template v-if="entities.loading">
      <ProgressBar class="tree__progress" />
      <p class="tree__note type-label">
        {{ $t('workspace.loading') }}
      </p>
    </template>
    <p
      v-else-if="entities.error"
      class="tree__note tree__note--error type-label"
    >
      {{ entities.error }}
    </p>
    <p
      v-else-if="total === 0"
      class="tree__note type-label"
    >
      {{ entities.filter ? $t('workspace.noMatch') : $t('workspace.noTables') }}
    </p>

    <div
      v-else
      class="tree__spacer"
      role="tree"
      :aria-label="$t('workspace.entities')"
      :style="{ height: `${total * rowHeight}px` }"
    >
      <!--
        The offset wrapper is a scroll-position implementation detail, so it is
        marked presentational: an untyped element between a tree and its items
        breaks the relationship a screen reader relies on to announce them.
      -->
      <div
        class="tree__window"
        role="presentation"
        :style="{ transform: `translateY(${window.first * rowHeight}px)` }"
      >
        <!--
          Every row is a tree item, not just the entities: a tree whose schema
          headers and column rows are untyped reads as a list with holes in it.
          The set size and position are stated explicitly because virtualisation
          means the DOM only ever holds a slice, and without them a screen
          reader announces "item 3 of 12" in a list of ten thousand.
        -->
        <div
          v-for="(row, index) in slice"
          :key="row.key"
          class="row"
          :class="[`row--${row.kind}`]"
          :style="{ paddingInlineStart: `calc(var(--gap) + ${row.depth} * 0.75rem)` }"
          role="treeitem"
          :aria-label="row.label"
          :aria-level="row.depth + 1"
          :aria-setsize="total"
          :aria-posinset="window.first + index + 1"
          :aria-expanded="opens(row) ? row.expanded : undefined"
          :tabindex="opens(row) ? 0 : -1"
          @click="activate(row)"
          @contextmenu="openMenu($event, row.entity)"
          @dblclick="row.entity && open(row.entity)"
          @keydown.enter="row.entity ? open(row.entity) : activate(row)"
          @keydown.right.prevent="!row.expanded && activate(row)"
          @keydown.left.prevent="row.expanded && activate(row)"
        >
          <!--
            A folder: database or schema. The same disclosure, icon and count as
            a table row, because they are the same kind of thing at different
            depths — which is the whole reason the tree is legible.
          -->
          <template v-if="row.kind === 'database' || row.kind === 'schema'">
            <AppIcon
              class="row__twisty"
              :class="{ 'row__twisty--open': row.expanded }"
              name="chevron"
              :size="12"
            />
            <AppIcon
              class="row__mark"
              :name="row.kind === 'database' ? 'database' : 'folder'"
              :size="13"
            />
            <span
              class="row__label"
              :class="`row__label--${row.kind}`"
            >{{ row.label }}</span>
            <span class="row__count">{{ row.detail }}</span>
          </template>

          <template v-else-if="row.kind === 'entity'">
            <AppIcon
              class="row__twisty"
              :class="{ 'row__twisty--open': row.expanded }"
              name="chevron"
              :size="12"
            />
            <AppIcon
              class="row__mark"
              :name="KIND_ICON[row.entityKind ?? 'table'] ?? 'table'"
              :size="13"
            />
            <span class="row__label">{{ row.label }}</span>
            <button
              class="row__action"
              :aria-label="$t('menu.actionsFor', { name: row.label })"
              :title="$t('menu.actionsFor', { name: row.label })"
              @pointerdown.stop
              @click.stop="openMenu($event, row.entity)"
            >
              <AppIcon
                name="more"
                :size="14"
              />
            </button>
          </template>

          <template v-else-if="row.kind === 'column'">
            <span class="row__label row__label--column">{{ row.label }}</span>
            <span class="row__type">{{ row.detail }}</span>
          </template>

          <template v-else>
            <span class="row__label row__label--muted">{{ row.label }}</span>
          </template>
        </div>
      </div>
    </div>

    <ContextMenu
      v-model="menuOpen"
      :items="menuItems"
      :at="menuAt"
      @choose="onChoose"
    />

    <QuickDocsSheet
      v-if="docsOf"
      v-model="docsOpen"
      :entity="docsOf"
    />

    <TablePropertiesSheet
      v-if="propertiesOf"
      v-model="propertiesOpen"
      :entity="propertiesOf"
    />

    <ExportSheet
      v-if="exportOf"
      v-model="exportOpen"
      :fields="NO_FIELDS"
      :rows="NO_ROWS"
      :name="exportOf.name"
      :write-file="writeEntityToFile"
    />
  </div>
</template>

<style scoped>
.tree {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

/* Fetching a schema over a slow link is the case the word alone did not cover. */
.tree__progress {
  margin-block: var(--gap-tight);
}

.tree__note {
  padding: var(--gap) var(--gap-loose);
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
}

.tree__note--error {
  color: var(--color-error);
}

.tree__probe {
  position: absolute;
  top: 0;
  width: 0;
  height: var(--sidebar-row-h);
  visibility: hidden;
  pointer-events: none;
}

.tree__spacer {
  position: relative;
}

.tree__window {
  position: absolute;
  inset-inline: 0;
  top: 0;
  will-change: transform;
}

.row {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  height: var(--sidebar-row-h);
  padding-inline-end: var(--gap);
  white-space: nowrap;
  font-size: 0.8125rem;
}

.row {
  border-radius: 0.4rem;
  margin-inline: var(--gap-tight);
  transition: background-color var(--t-press) var(--ease-out);
}

@media (hover: hover) and (pointer: fine) {
  .row--entity:hover,
  .row--schema:hover,
  .row--database:hover {
    background: var(--fill-4);
  }
}

.row__twisty {
  color: color-mix(in oklab, var(--color-base-content) 38%, transparent);
  transition: transform var(--t-pop) var(--ease-out);
}

.row__twisty--open {
  transform: rotate(90deg);
}

.row__mark {
  color: color-mix(in oklab, var(--color-base-content) 40%, transparent);
  transition: color var(--t-hover) var(--ease-out);
}

.row--entity:hover .row__mark,
.row--schema:hover .row__mark,
.row--database:hover .row__mark {
  color: var(--color-primary-text, var(--color-primary));
}

.row__label {
  overflow: hidden;
  text-overflow: ellipsis;
}

/*
 * A folder reads as a folder, not as a section heading.
 *
 * The schema row used to be small uppercase type with no disclosure — a label
 * over a list rather than a thing you open. Now that the tree has three levels
 * and every one of them opens, they all wear the same row.
 */
.row__label--database {
  font-weight: 600;
}

.row__label--schema {
  font-weight: 550;
  color: color-mix(in oklab, var(--color-base-content) 88%, transparent);
}

.row__label--column {
  padding-inline-start: 1.5rem;
  color: color-mix(in oklab, var(--color-base-content) 78%, transparent);
}

.row__label--muted {
  padding-inline-start: 1.5rem;
  font-size: 0.6875rem;
  color: color-mix(in oklab, var(--color-base-content) 40%, transparent);
}

/*
 * The label is small, but the thing you have to hit is not: the button fills
 * the row's height so the target is the full 28px even though the glyph inside
 * it is a third of that.
 */
.row__action {
  display: grid;
  place-items: center;
  margin-inline-start: auto;
  min-width: var(--sidebar-row-h);
  height: var(--sidebar-row-h);
  padding-inline: var(--gap-tight);
  font-size: 0.6875rem;
  opacity: 0;
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
  transition:
    opacity 120ms ease-out,
    color 120ms ease-out;
}

.row--entity:hover .row__action,
.row__action:focus-visible {
  opacity: 1;
}

.row__action:hover {
  color: var(--color-primary-text, var(--color-primary));
}

.row__type,
.row__count {
  margin-inline-start: auto;
  font-size: 0.625rem;
  font-family: var(--font-mono);
  color: color-mix(in oklab, var(--color-base-content) 42%, transparent);
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 45%;
}

@media (prefers-reduced-motion: reduce) {
  .row__twisty {
    transition: none;
  }
}
</style>
