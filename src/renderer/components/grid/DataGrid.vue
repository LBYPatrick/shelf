<script setup lang="ts">
/**
 * The result grid.
 *
 * Built on Tabulator for its virtual rendering and spreadsheet-style range
 * selection, but with its own appearance entirely: Tabulator's stylesheet is
 * replaced rather than extended, so the grid follows the accent, the density
 * scale and the light/dark theme like everything else.
 *
 * The grid is deliberately not reactive per-cell. Vue reactivity over a hundred
 * thousand cells is exactly the kind of thing that makes a grid feel heavy, so
 * data is handed to Tabulator imperatively and only the surrounding chrome is
 * reactive.
 */
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import ValueSheet from './ValueSheet.vue';
import {
  TabulatorFull as Tabulator,
  type ColumnDefinition,
  type CellComponent,
} from 'tabulator-tables';
import type { CellValue, Field, Row } from '@drivers/types';
import { displayValue } from '@shared/values';

const props = defineProps<{
  fields: readonly Field[];
  rows: readonly Row[];
  /** Columns the user may edit, and why the others are locked. */
  editable?: ReadonlyMap<string, { editable: boolean; reason?: string }>;
  loading?: boolean;
}>();

const emit = defineEmits<{
  edit: [{ row: Row; column: string; value: CellValue }];
  selectRow: [Row | null];
}>();

const container = ref<HTMLElement>();
const table = shallowRef<Tabulator>();

/** The cell being examined in full, opened with Shift+Enter or a click. */
const inspecting = ref<{ column: string; value: CellValue } | null>(null);
const inspectorOpen = ref(false);

function inspect(column: string, value: CellValue): void {
  inspecting.value = { column, value };
  inspectorOpen.value = true;
}

/** Null is a value, not an absence, so it is shown as such rather than blank. */
function formatCell(cell: CellComponent): string {
  const value = cell.getValue() as CellValue;
  if (value === null || value === undefined) {
    return '<span class="cell-null">NULL</span>';
  }
  const text = displayValue(value);
  return text === ''
    ? '<span class="cell-empty">empty</span>'
    : text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function columnsFor(fields: readonly Field[]): ColumnDefinition[] {
  return fields.map((field) => {
    const permission = props.editable?.get(field.name);
    return {
      title: field.name,
      field: field.name,
      formatter: formatCell,
      headerTooltip: field.dataType ?? field.name,
      resizable: true,
      minWidth: 64,
      ...(permission?.editable
        ? { editor: 'input' as const }
        : {
            // A locked cell says why it is locked; "why can't I edit this"
            // should never be a guess.
            ...(permission?.reason ? { tooltip: () => permission.reason ?? '' } : {}),
          }),
    };
  });
}

function build(): void {
  if (!container.value || table.value) return;

  const instance = new Tabulator(container.value, {
    data: props.rows as Row[],
    columns: columnsFor(props.fields),
    layout: 'fitDataStretch',
    height: '100%',
    renderVertical: 'virtual',
    // Horizontal virtual rendering positions columns itself and does not scroll
    // the header, which left the header and the body out of step by exactly the
    // scroll distance on any table wider than the pane. Vertical virtualisation
    // is what actually matters — that is where the row counts are.
    renderHorizontal: 'basic',
    placeholder: 'No rows',
    selectableRange: true,
    selectableRangeColumns: true,
    selectableRangeRows: true,
    selectableRangeClearCells: true,
    editTriggerEvent: 'dblclick',
    columnDefaults: { headerSortTristate: true },
    history: true,
  });

  instance.on('cellEdited', (cell: CellComponent) => {
    emit('edit', {
      row: cell.getRow().getData() as Row,
      column: cell.getField(),
      value: cell.getValue() as CellValue,
    });
  });

  instance.on('rowClick', (_event, row) => emit('selectRow', row.getData() as Row));

  /*
   * Keep the header aligned with the body.
   *
   * Tabulator's own header sync assumes the layout its stylesheet provides, and
   * this grid supplies its own. Without this the header stayed at scrollLeft 0
   * while the body scrolled, so on any table wider than the pane every column
   * label sat over the wrong column — the further you scrolled, the further out
   * it was.
   *
   * `scroll` fires on the compositor thread and this only writes a scroll
   * offset, so it stays in step without a frame of lag.
   */
  // Tabulator builds its DOM asynchronously, so the elements to bind to do not
  // exist yet when the constructor returns.
  instance.on('tableBuilt', () => {
    const holder = container.value?.querySelector<HTMLElement>('.tabulator-tableholder');
    const header = container.value?.querySelector<HTMLElement>('.tabulator-header');
    if (!holder || !header) return;

    syncHeader = () => {
      if (header.scrollLeft !== holder.scrollLeft) header.scrollLeft = holder.scrollLeft;
    };

    holder.addEventListener('scroll', syncHeader, { passive: true });
    scroller = holder;
  });

  // Shift+Enter opens the focused cell in full, which is the only way to read a
  // value that is wider or taller than a row.
  instance.on('cellClick', (event, cell) => {
    if (!(event as MouseEvent).shiftKey) return;
    inspect(cell.getField(), cell.getValue() as CellValue);
  });

  instance.on('keydown', ((event: KeyboardEvent) => {
    if (event.key !== 'Enter' || !event.shiftKey) return;
    const cell = instance.getSelectedRanges()[0]?.getCells()[0]?.[0];
    if (!cell) return;
    event.preventDefault();
    inspect(cell.getField(), cell.getValue() as CellValue);
  }) as never);

  table.value = instance;
}

/**
 * A grid built inside a hidden tab measures itself against a zero-height box and
 * lays its rows out against that. Watching the container means it corrects
 * itself the moment it is shown, and again whenever the pane is resized, rather
 * than needing every caller to remember to poke it.
 */
let observer: ResizeObserver | undefined;
let syncHeader: (() => void) | undefined;
let scroller: HTMLElement | undefined;

function visible(): boolean {
  const box = container.value?.getBoundingClientRect();
  return !!box && box.height > 0 && box.width > 0;
}

function redraw(): void {
  if (!visible()) return;
  // Construction is deferred rather than corrected: a table built against a
  // zero-size box lays its rows out against that, and redrawing afterwards does
  // not fully recover.
  if (!table.value) build();
  else table.value.redraw(true);
}

onMounted(() => {
  if (visible()) build();

  observer = new ResizeObserver(() => redraw());
  if (container.value) observer.observe(container.value);
});

onBeforeUnmount(() => {
  if (scroller && syncHeader) scroller.removeEventListener('scroll', syncHeader);
  scroller = undefined;
  syncHeader = undefined;
  observer?.disconnect();
  observer = undefined;
  table.value?.destroy();
  table.value = undefined;
});

defineExpose({ redraw });

// Replacing the columns rebuilds the header, so it is only done when the shape
// actually changed — re-running it on every page of the same table would reset
// the user's column widths.
// Data that arrives before the table exists is not lost: `build()` reads the
// current props, so the deferred construction picks it up.
watch(
  () => props.fields,
  (fields) => {
    void table.value?.setColumns(columnsFor(fields));
  }
);

watch(
  () => props.rows,
  (rows) => {
    void table.value?.replaceData(rows as Row[]);
  }
);
</script>

<template>
  <div class="grid-wrap">
    <div
      ref="container"
      class="grid"
    />
    <div
      v-if="loading"
      class="grid__veil"
      aria-hidden="true"
    />

    <ValueSheet
      v-if="inspecting"
      v-model="inspectorOpen"
      :column="inspecting.column"
      :value="inspecting.value"
    />
  </div>
</template>

<style scoped>
.grid-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
}

.grid {
  height: 100%;
}

/*
 * A loading veil rather than a spinner that replaces the data: keeping the
 * previous page visible while the next one loads means the eye stays where it
 * was instead of being sent back to an empty box.
 */
.grid__veil {
  position: absolute;
  inset: 0;
  background: color-mix(in oklab, var(--color-base-100) 45%, transparent);
  -webkit-backdrop-filter: blur(1px);
  backdrop-filter: blur(1px);
  pointer-events: none;
  animation: veil-in 140ms ease-out;
}

@keyframes veil-in {
  from {
    opacity: 0;
  }
}
</style>
