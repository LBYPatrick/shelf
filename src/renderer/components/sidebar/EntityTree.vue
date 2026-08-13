<script setup lang="ts">
/**
 * The entity list.
 *
 * Rows are virtualised over the flattened tree the store produces, so a schema
 * with tens of thousands of tables scrolls as smoothly as one with ten. Only
 * the rows in view exist in the DOM; expansion state lives in the store rather
 * than in the row components, which are destroyed as they scroll away.
 */
import { computed, ref } from 'vue';
import type { Entity } from '@drivers/types';
import AppIcon from '../ui/AppIcon.vue';
import { useEntities, type TreeRow } from '../../stores/entities';
import { useTabs } from '../../stores/tabs';

const entities = useEntities();
const tabs = useTabs();

const viewport = ref<HTMLElement>();
const scrollTop = ref(0);

/** Matches --sidebar-row-h at the default density; re-read on mount. */
const rowHeight = ref(24);
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

function activate(row: TreeRow): void {
  if (row.kind !== 'entity' || !row.entity) return;
  entities.toggle(row.entity);
}

function refOf(entity: Entity) {
  return { name: entity.name, ...(entity.schema ? { schema: entity.schema } : {}) };
}

function openStructure(entity: Entity): void {
  tabs.openEntity('structure', refOf(entity));
}

function open(entity: Entity): void {
  if (entity.kind === 'routine') return;
  tabs.openEntity('table', refOf(entity));
}

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
    <p
      v-if="entities.loading"
      class="tree__note type-label"
    >
      {{ $t('workspace.loading') }}
    </p>
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
          :aria-expanded="row.kind === 'entity' ? row.expanded : undefined"
          :tabindex="row.kind === 'entity' ? 0 : -1"
          @click="activate(row)"
          @dblclick="row.entity && open(row.entity)"
          @keydown.enter="row.entity && open(row.entity)"
          @keydown.right.prevent="row.entity && !row.expanded && entities.toggle(row.entity)"
          @keydown.left.prevent="row.entity && row.expanded && entities.toggle(row.entity)"
        >
          <template v-if="row.kind === 'entity'">
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
              :aria-label="$t('workspace.structureOf', { name: row.label })"
              :title="$t('structure.columns')"
              @click.stop="row.entity && openStructure(row.entity)"
            >
              <AppIcon
                name="structure"
                :size="12"
              />
            </button>
          </template>

          <template v-else-if="row.kind === 'column'">
            <span class="row__label row__label--column">{{ row.label }}</span>
            <span class="row__type">{{ row.detail }}</span>
          </template>

          <template v-else-if="row.kind === 'schema'">
            <span class="row__label row__label--schema">{{ row.label }}</span>
            <span class="row__count">{{ row.detail }}</span>
          </template>

          <template v-else>
            <span class="row__label row__label--muted">{{ row.label }}</span>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.tree__note {
  padding: var(--gap) var(--gap-loose);
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
}

.tree__note--error {
  color: var(--color-error);
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
  .row--schema:hover {
    background: color-mix(in oklab, var(--color-base-content) 6%, transparent);
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

.row--entity:hover .row__mark {
  color: var(--color-primary-text, var(--color-primary));
}

.row__label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.row__label--schema {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
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
