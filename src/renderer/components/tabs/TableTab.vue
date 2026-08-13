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
import DataGrid from '../grid/DataGrid.vue';
import FilterBar from '../grid/FilterBar.vue';
import ImportSheet from './ImportSheet.vue';
import AppIcon from '../ui/AppIcon.vue';
import PressButton from '../ui/PressButton.vue';

const props = defineProps<{ entity: EntityRef; active: boolean }>();

const connections = useConnections();
const { t } = useTranslation();

const PAGE_SIZE = 100;

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

/** Edits made but not yet written. */
const pending = ref<ChangeSet>({ inserts: [], updates: [], deletes: [] });
const pendingCount = computed(
  () =>
    pending.value.inserts.length + pending.value.updates.length + pending.value.deletes.length
);

const primaryKeys = ref<string[]>([]);

const lastPage = computed(() =>
  totalRows.value === null ? null : Math.max(0, Math.ceil(totalRows.value / PAGE_SIZE) - 1)
);

const canSkipToEnd = computed(
  () => (connections.active?.capabilities.cheapCount ?? false) && lastPage.value !== null
);

function connectionId(): string {
  const id = connections.active?.id;
  if (!id) throw new Error('No open connection');
  return id;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    const result = await host.call('data/select', {
      connectionId: connectionId(),
      request: {
        entity: props.entity,
        offset: page.value * PAGE_SIZE,
        limit: PAGE_SIZE,
        ...(orderBy.value.length ? { orderBy: orderBy.value } : {}),
        ...(appliedFilter.value ? { filters: appliedFilter.value } : {}),
      },
    });

    rows.value = [...result.rows];
    fields.value = [...result.fields];
    if (result.totalRowCount !== undefined) totalRows.value = result.totalRowCount;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

async function loadMetadata(): Promise<void> {
  try {
    const columns = await host.call('schema/columns', {
      connectionId: connectionId(),
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
        connectionId: connectionId(),
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
    await host.call('changes/apply', { connectionId: connectionId(), changes: pending.value });
    pending.value = { inserts: [], updates: [], deletes: [] };
    await load();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

async function previewChanges(): Promise<void> {
  if (pendingCount.value === 0) return;
  const sql = await host.call('changes/preview', {
    connectionId: connectionId(),
    changes: pending.value,
  });
  await navigator.clipboard.writeText(sql);
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
 * Export writes in the connection host, straight to the chosen file — the rows
 * never come through this process, so the size of the table does not matter.
 */
async function exportView(): Promise<void> {
  const path = await window.shelf.dialogs.saveFile({
    title: `Export ${props.entity.name}`,
    defaultPath: `${props.entity.name}.csv`,
    extensions: ['csv', 'json', 'jsonl', 'sql'],
  });
  if (!path) return;

  const format = (path.split('.').pop() ?? 'csv').toLowerCase();
  const chosen = ['csv', 'json', 'jsonl', 'sql'].includes(format)
    ? (format as 'csv' | 'json' | 'jsonl' | 'sql')
    : 'csv';

  exporting.value = true;
  error.value = null;

  try {
    await host.call('export/run', {
      connectionId: connectionId(),
      path,
      format: chosen,
      entity: props.entity,
      // The filter in force is exported too: what you are looking at is what
      // you get, which is almost always what was meant.
      ...(appliedFilter.value ? { filters: appliedFilter.value } : {}),
    });
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    exporting.value = false;
  }
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

onMounted(async () => {
  await Promise.all([load(), loadMetadata()]);
});

// Becoming visible is the moment the grid can finally measure itself.
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
        <AppIcon
          name="pencil"
          :size="12"
        />
        {{ $t('table.editData') }}
      </button>

      <!--
        The ledger only exists when there is something in it, and it carries its
        own count so "save" never has to be pressed to find out how much it is
        about to do.
      -->
      <span
        v-if="pendingCount > 0"
        class="toolbar__pending"
      >
        <span class="toolbar__badge">{{ pendingCount }}</span>
        <button
          type="button"
          class="toolbar__action focus-fill"
          @click="discard"
        >
          {{ $t('action.discard') }}
        </button>
        <button
          type="button"
          class="toolbar__action focus-fill"
          @click="previewChanges"
        >
          {{ $t('action.copySql') }}
        </button>
        <PressButton
          size="sm"
          variant="primary"
          @click="applyChanges"
        >
          {{ $t('action.save') }}
        </PressButton>
      </span>

      <span class="toolbar__spacer" />

      <span
        v-if="imported !== null"
        class="toolbar__done"
      >{{
        $t('table.imported', { count: imported })
      }}</span>

      <button
        type="button"
        class="toolbar__action toolbar__action--icon focus-fill"
        :title="$t('action.refresh')"
        :aria-label="$t('action.refresh')"
        @click="load()"
      >
        <AppIcon
          name="refresh"
          :size="12"
        />
      </button>

      <button
        v-if="canImport"
        type="button"
        class="toolbar__action focus-fill"
        @click="importing = true"
      >
        <AppIcon
          name="upload"
          :size="12"
        />
        {{ $t('action.import') }}
      </button>

      <button
        type="button"
        class="toolbar__action focus-fill"
        :disabled="exporting"
        @click="exportView"
      >
        <AppIcon
          name="download"
          :size="12"
        />
        {{ exporting ? $t('table.exporting') : $t('action.export') }}
      </button>
    </div>

    <FilterBar
      :columns="allColumns"
      :applied="appliedFilter"
      @apply="onFilterApplied"
    />

    <p
      v-if="error"
      class="table-tab__error"
      role="alert"
    >
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

    <ImportSheet
      v-if="canImport"
      v-model="importing"
      :entity="entity"
      :columns="allColumns"
      :connection-id="connectionId()"
      @done="afterImport"
    />

    <Teleport
      v-if="active"
      to="#statusbar-slot"
      defer
    >
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
          <span class="tabstatus__page">{{ page + 1 }}{{ lastPage === null ? '' : ` / ${lastPage + 1}` }}</span>
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
 * One row, one rhythm. Everything in it is the same height and the same shape;
 * what differs is how loud each thing is — the edit switch carries a surface
 * when it is on, the actions stay quiet until reached for, and only a
 * destructive-or-committing action is ever filled.
 */

.toolbar__mode,
.toolbar__action {
  display: inline-flex;
  align-items: center;
  gap: var(--gap-tight);
  height: var(--field-h);
  padding-inline: var(--gap);
  border-radius: var(--control-radius);
  color: color-mix(in oklab, var(--color-base-content) 72%, transparent);
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
  transition:
    background-color var(--t-hover) var(--ease-out),
    color var(--t-hover) var(--ease-out);
}

@media (hover: hover) and (pointer: fine) {
  .toolbar__action:not(:disabled):hover,
  .toolbar__mode:not(.toolbar__mode--on):not(:disabled):hover {
    background-color: var(--fill-4);
    color: var(--color-base-content);
  }
}

.toolbar__pending {
  display: flex;
  align-items: center;
  gap: var(--gap-hair);
  padding-inline-start: var(--gap);
  margin-inline-start: var(--gap-tight);
  border-inline-start: 1px solid color-mix(in oklab, var(--color-base-content) 10%, transparent);
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

.tabstatus {
  display: flex;
  align-items: center;
  gap: var(--gap-loose);
  white-space: nowrap;
}

.tabstatus__item,
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

.tabstatus__badge {
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
</style>
