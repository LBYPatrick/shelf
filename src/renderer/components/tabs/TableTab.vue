<script setup lang="ts">
/**
 * A table's data.
 *
 * Reads are paged rather than infinite-scrolled: a page number is a position
 * you can return to and talk about, and it keeps memory bounded on a table with
 * a hundred million rows. Edits accumulate in a ledger and are applied in one
 * transaction, so the grid never writes behind the user's back.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import type {
  CellValue,
  ChangeSet,
  Column,
  EntityRef,
  Field,
  Filters,
  OrderBy,
  Row,
} from '@drivers/types';
import { useTranslation } from 'i18next-vue';
import { host } from '../../lib/host';
import { useConnections } from '../../stores/connections';
import { useSettings } from '../../stores/settings';
import { useActivity } from '../../stores/activity';
import { useToasts } from '../../stores/toasts';
import { useHotkeys } from '../../composables/useHotkeys';
import DataGrid from '../grid/DataGrid.vue';
import ExportSheet from '../grid/ExportSheet.vue';
import FilterBar from '../grid/FilterBar.vue';
import RowIndexToggle from '../grid/RowIndexToggle.vue';
import ImportSheet from './ImportSheet.vue';
import AppIcon from '../ui/AppIcon.vue';
import PressButton from '../ui/PressButton.vue';
import { errorMessage } from '@shared/errors';
import { slugify } from '@shared/fileNames';

const props = defineProps<{ entity: EntityRef; active: boolean }>();

const connections = useConnections();
const settings = useSettings();
const activity = useActivity();
const toasts = useToasts();
const { t } = useTranslation();

/*
 * Read live rather than captured, so changing it in Settings takes effect on
 * the next page rather than only in tabs opened afterwards.
 */
const pageSize = computed(() => settings.values.pageSize);

const rows = ref<Row[]>([]);
const fields = ref<Field[]>([]);
const totalRows = ref<number | null>(null);
const page = ref(0);
const orderBy = ref<OrderBy[]>([]);
const appliedFilter = ref<Filters | undefined>(undefined);
const loading = ref(false);
const error = ref<string | null>(null);
const columnPermissions = ref(new Map<string, { editable: boolean; reason?: string }>());

/** What the grid is actually allowed to edit right now. */
const editability = computed(() => {
  if (!editMode.value) {
    return new Map(
      [...columnPermissions.value.keys()].map((name) => [
        name,
        { editable: false, reason: 'Turn on Edit data to change values.' },
      ])
    );
  }
  return columnPermissions.value;
});
const grid = ref<InstanceType<typeof DataGrid>>();
const filterBar = ref<InstanceType<typeof FilterBar>>();

/** Edits made but not yet written. */
const pending = ref<ChangeSet>({ inserts: [], updates: [], deletes: [] });
const pendingCount = computed(
  () =>
    pending.value.inserts.length + pending.value.updates.length + pending.value.deletes.length
);

const primaryKeys = ref<string[]>([]);

const lastPage = computed(() =>
  totalRows.value === null ? null : Math.max(0, Math.ceil(totalRows.value / pageSize.value) - 1)
);

const canSkipToEnd = computed(
  () => (connections.active?.capabilities.cheapCount ?? false) && lastPage.value !== null
);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    const result = await activity.track(
      host.call('data/select', {
        connectionId: connections.requireId(),
        request: {
          entity: props.entity,
          offset: page.value * pageSize.value,
          limit: pageSize.value,
          ...(orderBy.value.length ? { orderBy: orderBy.value } : {}),
          ...(appliedFilter.value ? { filters: appliedFilter.value } : {}),
        },
      })
    );

    rows.value = [...result.rows];
    fields.value = [...result.fields];
    if (result.totalRowCount !== undefined) totalRows.value = result.totalRowCount;
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    loading.value = false;
  }
}

async function loadMetadata(): Promise<void> {
  try {
    const columns = await host.call('schema/columns', {
      connectionId: connections.requireId(),
      entity: props.entity,
    });

    allColumns.value = [...columns];
    primaryKeys.value = columns
      .filter((column) => column.primaryKey)
      .map((column) => column.name);

    const readOnly = connections.active?.readOnly ?? false;
    const hasKey = primaryKeys.value.length > 0;

    columnPermissions.value = new Map(
      columns.map((column) => [
        column.name,
        readOnly
          ? { editable: false, reason: 'This connection is read-only.' }
          : column.generated
            ? { editable: false, reason: 'Generated columns are computed by the database.' }
            : !hasKey
              ? {
                  editable: false,
                  reason: 'This table has no primary key, so a row cannot be addressed.',
                }
              : { editable: true },
      ])
    );

    if (totalRows.value === null && connections.active?.capabilities.cheapCount) {
      totalRows.value = await host.call('data/count', {
        connectionId: connections.requireId(),
        entity: props.entity,
        ...(appliedFilter.value ? { filters: appliedFilter.value } : {}),
      });
    }
  } catch {
    // Metadata is an enhancement; the data still loads without it.
    columnPermissions.value = new Map();
  }
}

/** Sorting or filtering would throw away pending edits, so ask first. */
async function guardPending(action: () => void): Promise<void> {
  if (pendingCount.value > 0) {
    const message = `Discard ${pendingCount.value} unsaved change${pendingCount.value === 1 ? '' : 's'}?`;
    if (!globalThis.confirm(message)) return;
    pending.value = { inserts: [], updates: [], deletes: [] };
  }
  action();
  await load();
}

/*
 * Changing the filter throws away whatever page you were on, and would throw
 * away pending edits with it — so it goes through the same guard sorting and
 * paging do rather than having its own idea of when to ask.
 */
function onFilterApplied(filters: Filters | undefined): void {
  void guardPending(() => {
    appliedFilter.value = filters;
    totalRows.value = null;
    page.value = 0;
  });
}

function goToPage(target: number): void {
  void guardPending(() => {
    page.value = Math.max(
      0,
      lastPage.value === null ? target : Math.min(target, lastPage.value)
    );
  });
}

function recordEdit(event: { row: Row; column: string; value: CellValue }): void {
  const keys = primaryKeys.value.map((column) => ({
    column,
    value: event.row[column] ?? null,
  }));
  if (keys.length === 0) return;

  const updates = pending.value.updates.filter(
    (update) =>
      update.column !== event.column ||
      update.primaryKeys.some((key, index) => key.value !== keys[index]?.value)
  );

  pending.value = {
    ...pending.value,
    updates: [
      ...updates,
      { entity: props.entity, primaryKeys: keys, column: event.column, value: event.value },
    ],
  };
}

async function applyChanges(): Promise<void> {
  if (pendingCount.value === 0) return;
  loading.value = true;
  error.value = null;

  try {
    await host.call('changes/apply', {
      connectionId: connections.requireId(),
      changes: pending.value,
    });
    pending.value = { inserts: [], updates: [], deletes: [] };
    await load();
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    loading.value = false;
  }
}

async function previewChanges(): Promise<void> {
  if (pendingCount.value === 0) return;
  const sql = await host.call('changes/preview', {
    connectionId: connections.requireId(),
    changes: pending.value,
  });
  await navigator.clipboard.writeText(sql);
  // A clipboard write is invisible by nature: nothing on screen changes, so
  // without this the button was indistinguishable from a dead one.
  toasts.show({
    tone: 'success',
    message: t('table.sqlCopied', { count: pendingCount.value }),
  });
}

/**
 * Editing is a mode you enter, not something that is always on.
 *
 * A grid where any double-click writes to production is a grid people are wary
 * of. Turning it on deliberately makes the rest of the session relaxed, and
 * makes the pending-changes ledger something you opted into.
 */
const editMode = ref(false);

const exporting = ref(false);
const importing = ref(false);

/**
 * The filter is asked for, not always present.
 *
 * It used to occupy a full row above every table whether or not anyone was
 * filtering — a second band of chrome between the toolbar and the first row of
 * data, on a screen whose entire job is showing rows. It opens by itself when
 * a filter is in force, so it can never hide one.
 */
const filterOpen = ref(false);

const filterCount = computed(() => {
  const applied = appliedFilter.value;
  if (!applied) return 0;
  return applied.kind === 'builder' ? applied.filters.length : 1;
});
const allColumns = ref<Column[]>([]);
const canImport = computed(
  () => (connections.active?.capabilities.ddl ?? false) && !connections.active?.readOnly
);

async function afterImport(inserted: number): Promise<void> {
  error.value = null;
  totalRows.value = null;
  await load();
  // A silent success on an import is unnerving; say how many arrived.
  imported.value = inserted;
  setTimeout(() => (imported.value = null), 6000);
}

const imported = ref<number | null>(null);

/**
 * Export goes through the same sheet the query tab uses, so the shape and the
 * destination are chosen the same way in both places. Previously this tab
 * inferred the format from whatever extension you happened to type into the
 * save dialog, which silently fell back to CSV when you typed anything else.
 *
 * The host writes the file, so the whole table is exported rather than the
 * hundred rows this page happens to hold.
 */
async function writeTableToFile(
  path: string,
  format: 'csv' | 'json' | 'jsonl' | 'sql'
): Promise<void> {
  await host.call('export/run', {
    connectionId: connections.requireId(),
    path,
    format,
    entity: props.entity,
    // The filter in force is exported too: what you are looking at is what
    // you get, which is almost always what was meant.
    ...(appliedFilter.value ? { filters: appliedFilter.value } : {}),
  });
}

function toggleEditMode(): void {
  if (editMode.value && pendingCount.value > 0) {
    const message = t('table.discardChanges', { count: pendingCount.value });
    if (!globalThis.confirm(message)) return;
    pending.value = { inserts: [], updates: [], deletes: [] };
    void load();
  }
  editMode.value = !editMode.value;
}

function discard(): void {
  pending.value = { inserts: [], updates: [], deletes: [] };
  void load();
}

/*
 * `data.filter` and `data.apply` were declared in the bindings table, listed in
 * Settings and printed in the README, and nothing anywhere handled either of
 * them. They belong to this tab rather than to the workspace, so they are
 * registered here — and guarded on `active`, because every open tab stays
 * mounted and would otherwise all answer the same keystroke.
 */
useHotkeys({
  'data.filter': () => {
    if (!props.active) return;
    filterOpen.value = true;
    filterBar.value?.focus();
  },
  'data.apply': () => {
    if (!props.active || pendingCount.value === 0) return;
    void applyChanges();
  },
});

onMounted(async () => {
  await Promise.all([load(), loadMetadata()]);
});

/*
 * Becoming visible is the moment the grid can finally measure itself. The
 * container's own observer sees the same edge, so this is the belt to its
 * braces — free now that a redraw against an unchanged box does nothing, and
 * worth keeping because the alternative failure is a pane that never builds.
 */
watch(
  () => props.active,
  (isActive) => {
    if (isActive) void nextTick(() => grid.value?.redraw());
  }
);

watch(
  () => props.entity,
  () => {
    page.value = 0;
    totalRows.value = null;
    void load();
    void loadMetadata();
  }
);
</script>

<template>
  <div class="table-tab">
    <div class="toolbar">
      <!--
        Editing is a mode, not an action, so it reads as a switch that is on or
        off rather than a button you press. Everything to its right acts on the
        table as it stands and is quiet until reached for.
      -->
      <button
        type="button"
        class="toolbar__mode focus-fill"
        :class="{ 'toolbar__mode--on': editMode }"
        :aria-pressed="editMode"
        :disabled="connections.active?.readOnly"
        :title="
          connections.active?.readOnly ? $t('connection.readOnlyHelp') : $t('table.editHint')
        "
        @click="toggleEditMode"
      >
        <AppIcon name="pencil" :size="12" />
        {{ $t('table.editData') }}
      </button>

      <!--
        Filtering is a mode too, and it wears the same surface Edit data does
        while a filter is in force — so closing the bar cannot hide the fact
        that what you are looking at is a subset.
      -->
      <button
        type="button"
        class="toolbar__mode focus-fill"
        :class="{ 'toolbar__mode--on': filterCount > 0 }"
        :aria-pressed="filterOpen"
        :aria-expanded="filterOpen"
        @click="filterOpen = !filterOpen"
      >
        <AppIcon name="filter" :size="12" />
        {{ $t('action.filter') }}
        <span v-if="filterCount > 0" class="toolbar__count">{{ filterCount }}</span>
      </button>

      <!--
        The ledger only exists when there is something in it, and it carries its
        own count so "save" never has to be pressed to find out how much it is
        about to do.
      -->
      <span v-if="pendingCount > 0" class="toolbar__pending">
        <span class="toolbar__badge">{{ pendingCount }}</span>
        <button type="button" class="toolbar__action focus-fill" @click="discard">
          {{ $t('action.discard') }}
        </button>
        <button type="button" class="toolbar__action focus-fill" @click="previewChanges">
          {{ $t('action.copySql') }}
        </button>
        <PressButton size="sm" variant="primary" @click="applyChanges">
          {{ $t('action.save') }}
        </PressButton>
      </span>

      <span class="toolbar__spacer" />

      <span v-if="imported !== null" class="toolbar__done">{{
        $t('table.imported', { count: imported })
      }}</span>

      <RowIndexToggle />

      <button
        type="button"
        class="toolbar__action toolbar__action--icon focus-fill"
        :title="$t('action.refresh')"
        :aria-label="$t('action.refresh')"
        @click="load()"
      >
        <AppIcon name="refresh" :size="12" />
      </button>

      <button
        v-if="canImport"
        type="button"
        class="toolbar__action focus-fill"
        @click="importing = true"
      >
        <AppIcon name="upload" :size="12" />
        {{ $t('action.import') }}
      </button>

      <button type="button" class="toolbar__action focus-fill" @click="exporting = true">
        <AppIcon name="download" :size="12" />
        {{ $t('action.export') }}
      </button>
    </div>

    <div class="table-tab__filter" :class="{ 'table-tab__filter--open': filterOpen }">
      <div class="table-tab__filter-inner">
        <FilterBar
          ref="filterBar"
          :columns="allColumns"
          :applied="appliedFilter"
          @apply="onFilterApplied"
        />
      </div>
    </div>

    <p v-if="error" class="table-tab__error" role="alert">
      {{ error }}
    </p>

    <DataGrid
      ref="grid"
      :fields="fields"
      :rows="rows"
      :editable="editability"
      :loading="loading"
      @edit="recordEdit"
    />

    <ExportSheet
      v-model="exporting"
      :fields="fields"
      :rows="rows as readonly Record<string, CellValue>[]"
      :name="slugify(entity.name)"
      :write-file="writeTableToFile"
    />

    <ImportSheet
      v-if="canImport"
      v-model="importing"
      :entity="entity"
      :columns="allColumns"
      :connection-id="connections.requireId()"
      @done="afterImport"
    />

    <Teleport v-if="active" to="#statusbar-slot" defer>
      <div class="tabstatus">
        <span class="tabstatus__item">
          {{
            totalRows === null ? `${rows.length} rows` : `${totalRows.toLocaleString()} rows`
          }}
        </span>

        <span class="tabstatus__pager">
          <PressButton
            size="sm"
            :disabled="page === 0"
            :aria-label="$t('table.firstPage')"
            @click="goToPage(0)"
          >
            «
          </PressButton>
          <PressButton
            size="sm"
            :disabled="page === 0"
            :aria-label="$t('table.previousPage')"
            @click="goToPage(page - 1)"
          >
            ‹
          </PressButton>
          <span class="tabstatus__page"
            >{{ page + 1 }}{{ lastPage === null ? '' : ` / ${lastPage + 1}` }}</span
          >
          <PressButton
            size="sm"
            :disabled="lastPage !== null && page >= lastPage"
            :aria-label="$t('table.nextPage')"
            @click="goToPage(page + 1)"
          >
            ›
          </PressButton>
          <PressButton
            v-if="canSkipToEnd"
            size="sm"
            :disabled="page === lastPage"
            :aria-label="$t('table.lastPage')"
            @click="goToPage(lastPage ?? 0)"
          >
            »
          </PressButton>
        </span>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.table-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/*
 * The row's shape, its heights and its hover come from `styles/controls.css`.
 * They were copied here as well, which is exactly the drift that file exists to
 * prevent — two definitions of one bar, kept in agreement by hand.
 */
.table-tab > .toolbar {
  flex: 0 0 auto;
  border-bottom: 1px solid var(--separator);
}

.toolbar__pending {
  display: flex;
  align-items: center;
  gap: var(--gap-hair);
  padding-inline-start: var(--gap);
  margin-inline-start: var(--gap-tight);
  border-inline-start: 1px solid var(--separator);
}

.toolbar__badge {
  display: grid;
  place-items: center;
  min-width: 1.125rem;
  height: 1.125rem;
  padding-inline: 0.25rem;
  border-radius: 999px;
  background: var(--color-warning);
  color: var(--color-warning-content);
  font-size: 0.625rem;
  font-weight: 600;
}

/*
 * The ledger's badge is amber because unsaved writes are a thing to be warned
 * about. A filter is not — it is a mode you chose — so its count borrows the
 * mode's own colour instead. That one is `.toolbar__count` in `controls.css`,
 * with the rest of the bar, because the query tab's result switcher wears it
 * too.
 */

/*
 * The bar grows out of the toolbar it was summoned from rather than appearing
 * whole, and the grid below slides by exactly the bar's height so the eye
 * follows the rows it was reading instead of re-finding them.
 *
 * A `0fr` to `1fr` row track is what makes that animatable without anyone
 * measuring the bar first — its natural height is whatever its conditions need,
 * and a hardcoded max-height would either clip three conditions or coast
 * through empty space on the way to one.
 */
.table-tab__filter {
  display: grid;
  grid-template-rows: 0fr;
  flex: 0 0 auto;
  opacity: 0;
  transition:
    grid-template-rows var(--t-pop) var(--ease-out),
    opacity var(--t-pop) var(--ease-out);
}

.table-tab__filter--open {
  grid-template-rows: 1fr;
  opacity: 1;
}

.table-tab__filter-inner {
  overflow: hidden;
  min-height: 0;
}

.toolbar__done {
  font-size: 0.625rem;
  padding: 1px 7px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--color-success) 24%, transparent);
}

.table-tab__error {
  padding: var(--gap) var(--gap-loose);
  background: color-mix(in oklab, var(--color-error) 16%, transparent);
  font-size: 0.75rem;
}

/* The page indicator reads as a status item; it just is not one structurally. */
.tabstatus__page {
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
}

.tabstatus__pager,
.tabstatus__pending {
  display: flex;
  align-items: center;
  gap: var(--gap-hair);
}

.tabstatus__done {
  font-size: 0.625rem;
  padding: 1px 7px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--color-success) 24%, transparent);
  animation: done-in 260ms var(--ease-out);
}

@keyframes done-in {
  from {
    opacity: 0;
    transform: translateY(3px);
  }
}
</style>
