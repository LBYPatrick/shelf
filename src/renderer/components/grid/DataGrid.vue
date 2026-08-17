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
import ProgressBar from '../ui/ProgressBar.vue';
import ValueSheet from './ValueSheet.vue';
import {
  TabulatorFull as Tabulator,
  type ColumnDefinition,
  type CellComponent,
} from 'tabulator-tables';
import type { CellValue, Field, Row } from '@drivers/types';
import { displayValue } from '@shared/values';
import { isNumericType } from '@shared/columnTypes';
import { columnWidths, fontOf, stretchLast } from '../../lib/columnWidths';
import { useSettings } from '../../stores/settings';

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

const settings = useSettings();

/** The row-number gutter, which is frozen and never sized from its data. */
const GUTTER = 56;

const container = ref<HTMLElement>();
const probe = ref<HTMLElement>();
const table = shallowRef<Tabulator>();

/** The cell being examined in full, opened with Shift+Enter or a click. */
const inspecting = ref<{ column: string; value: CellValue } | null>(null);
const inspectorOpen = ref(false);

function inspect(column: string, value: CellValue): void {
  inspecting.value = { column, value };
  inspectorOpen.value = true;
}

/**
 * Null is a value, not an absence, so it is shown as such rather than blank.
 *
 * The column's declared type comes in with the formatter because it decides how
 * an instant is written: a `date` column has no time of day, and rendering the
 * transport's full ISO instant spent twenty-four characters of width on ten
 * characters of information.
 */
function formatCellOf(field: Field) {
  return (cell: CellComponent): string => {
    const value = cell.getValue() as CellValue;
    if (value === null || value === undefined) {
      return '<span class="cell-null">NULL</span>';
    }

    const text = displayValue(value, {
      encoding: settings.values.binaryEncoding,
      ...(field.dataType === undefined ? {} : { dataType: field.dataType }),
    });
    return text === ''
      ? '<span class="cell-empty">empty</span>'
      : text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  };
}

/**
 * What a cell will show, as text — the same answer the formatter gives, minus
 * the markup. Widths are measured from this rather than from the raw value: a
 * buffer renders as hex and a date as a shortened instant, and neither is the
 * width of what came off the wire.
 */
function cellText(row: Row, field: Field): string {
  const value = row[field.name];
  if (value === null || value === undefined) return 'NULL';

  const text = displayValue(value as CellValue, {
    encoding: settings.values.binaryEncoding,
    ...(field.dataType === undefined ? {} : { dataType: field.dataType }),
  });
  return text === '' ? 'empty' : text;
}

/**
 * Widths, measured once, in a canvas.
 *
 * Tabulator's `fitDataStretch` re-measured every cell of every column on every
 * layout by clearing the width and reading `offsetWidth` back — a forced reflow
 * each time, and it ran on every resize of the pane. Handing it explicit widths
 * and the plain `fitData` mode means it never does that: the numbers are worked
 * out from text metrics, which cost no layout at all.
 */
/** The widths the data asked for, before the last column took up the slack. */
let natural = new Map<string, number>();

function measureColumns(fields: readonly Field[], rows: readonly Row[]): Map<string, number> {
  const host = container.value;
  const glyphs = probe.value;
  if (!host || !glyphs) return new Map();

  const widths = columnWidths(
    fields.map((field) => field.name),
    rows,
    (row, name) => {
      const field = fields.find((candidate) => candidate.name === name);
      return field ? cellText(row, field) : '';
    },
    /*
     * From a probe wearing the cell's own declarations, not from the container.
     * The container carries the interface face and the cells are monospace at
     * weight 500, which is wider per character — measured against the wrong one,
     * every column came out short and the headers were the first to be cut.
     */
    { font: fontOf(glyphs), min: 64, max: 420 }
  );

  natural = new Map(widths);

  // The gutter is fixed, so the slack is whatever the data columns leave.
  stretchLast(
    widths,
    fields.map((field) => field.name),
    host.clientWidth - GUTTER
  );

  return widths;
}

/**
 * Gives the last column the room a wider pane just made, without re-measuring.
 *
 * This is all a resize actually needs. Tabulator's own answer is `redraw(true)`,
 * which force-fits *every* column — clearing each width and reading
 * `offsetWidth` back off every cell — and it does that even in `fitData` mode,
 * so the explicit widths bought nothing on a resize. Three of those ran during
 * one sidebar collapse, at about a fifth of a second each.
 */
function restretch(): void {
  const instance = table.value;
  const host = container.value;
  if (!instance || !host || natural.size === 0) return;

  const wanted = new Map(natural);
  stretchLast(wanted, [...natural.keys()], host.clientWidth - GUTTER);

  const last = [...natural.keys()].pop();
  if (last === undefined) return;

  const width = wanted.get(last);
  const column = instance.getColumn(last);
  if (width !== undefined && column && column.getWidth() !== width) column.setWidth(width);
}

function columnsFor(fields: readonly Field[], widths: Map<string, number>): ColumnDefinition[] {
  return fields.map((field) => {
    const permission = props.editable?.get(field.name);
    return {
      title: field.name,
      field: field.name,
      formatter: formatCellOf(field),
      headerTooltip: field.dataType ?? field.name,
      resizable: true,
      minWidth: 64,
      ...(widths.has(field.name) ? { width: widths.get(field.name) } : {}),
      /*
       * Numbers align on their last digit, the way every spreadsheet and every
       * printed table does: it is what lets you compare magnitudes down a
       * column without reading a single value. Text stays left.
       *
       * Marked with a class rather than Tabulator's `hozAlign`, which writes an
       * inline `text-align` — and this stylesheet lays every cell out as a flex
       * row, where text-align has nothing to act on.
       */
      ...(isNumericType(field.dataType)
        ? { cssClass: 'col-numeric', headerCssClass: 'col-numeric' }
        : {}),
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

/**
 * Every time the table is built or redrawn, where a test can see it.
 *
 * How often this happens is the whole point of the guards above and is
 * otherwise invisible: the grid looks identical whether it drew once or twenty
 * times, and the only symptom is a window that stops for a moment.
 */
function countRedraw(): void {
  const at = container.value?.dataset;
  if (at) at['redraws'] = String(Number(at['redraws'] ?? 0) + 1);
}

function build(): void {
  if (!container.value || table.value) return;

  const instance = new Tabulator(container.value, {
    data: props.rows as Row[],
    columns: columnsFor(props.fields, measureColumns(props.fields, props.rows as Row[])),
    /*
     * `fitData`, not `fitDataStretch`. The stretch mode re-fits every column on
     * every layout — see `columnWidths` — and the widths are ours now anyway.
     * Plain `fitData` only refits when a layout is explicitly forced, which is
     * never, because nothing about a wider pane changes how wide a column's
     * contents are.
     */
    layout: 'fitData',
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
    /*
     * The row-number gutter.
     *
     * Not the same thing as the table's key, which is what the argument for
     * leaving it out used to be: a key tells you *which row this is*, and a row
     * number tells you *where you are* — which of ten thousand rows you have
     * scrolled to, and how far apart two rows you are comparing sit. A query
     * result often has no key at all.
     *
     * The formatter reads the base on every render rather than closing over it,
     * so flipping the toggle is a redraw and not a rebuild.
     */
    rowHeader: {
      title: '',
      field: '',
      headerSort: false,
      resizable: false,
      frozen: true,
      width: GUTTER,
      minWidth: 44,
      hozAlign: 'right',
      cssClass: 'col-rownum',
      headerCssClass: 'col-rownum',
      formatter: (cell: CellComponent) => {
        const position = cell.getRow().getPosition();
        if (typeof position !== 'number') return '';
        return String(settings.values.rowIndexBase === 0 ? position - 1 : position);
      },
    },
    /*
     * Resizing is ours. Tabulator installs a resize observer of its own and
     * redraws the table from it, so a sidebar collapse had two observers each
     * answering every frame of a quarter-second animation — and ours already
     * knows to wait for the size to stop changing and to leave the columns
     * alone when it does.
     */
    autoResize: false,
    editTriggerEvent: settings.values.editTrigger,
    columnDefaults: { headerSortTristate: true },
    history: true,
  });

  /*
   * Counted where a test can see it. How often the expensive relayout runs is
   * the whole point of the guard in `redraw`, and it is otherwise invisible:
   * the grid looks identical whether it ran once or twenty times, and the only
   * symptom is a window that stops for a moment.
   */
  countRedraw();

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

    /*
     * The header also has to be *able* to scroll as far as the body.
     *
     * The body reserves room for a vertical scrollbar and the header does not,
     * so the header's scrollable extent is short by exactly that width — and at
     * the far right the assignment below silently clamps, leaving every column
     * label sitting a scrollbar's width from its data. It went unnoticed until
     * the row-number gutter changed the geometry enough to make the gap
     * measurable.
     *
     * The padding goes on the header's *contents*, not on the header itself:
     * the header is an `overflow: hidden` box whose `scrollWidth` is decided by
     * that child, so padding on the outer element changes nothing. Measured
     * rather than assumed — the scrollbar is only there while the rows overflow.
     */
    const contents = header.querySelector<HTMLElement>('.tabulator-header-contents');
    let gutter = -1;

    syncHeader = () => {
      const measured = holder.offsetWidth - holder.clientWidth;
      if (contents && measured !== gutter) {
        gutter = measured;
        contents.style.paddingInlineEnd = `${measured}px`;
      }
      if (header.scrollLeft !== holder.scrollLeft) header.scrollLeft = holder.scrollLeft;
    };

    syncHeader();

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

/**
 * The box the table was last laid out against.
 *
 * Even a cheap redraw is a re-render of every visible row, and a tab switch
 * asked for one for nothing: hiding a pane takes its box to zero and showing it
 * again brings back exactly the box it had, the observer fired on both edges,
 * and the tab's own watch asked a second time. Nothing had changed either time.
 */
let laidOutAt: { width: number; height: number } | undefined;
let queued = 0;

/** Long enough to sit out a panel transition, short enough not to be noticed. */
const SETTLE = 90;

function redraw(): void {
  const box = container.value?.getBoundingClientRect();
  if (!box || box.height === 0 || box.width === 0) return;

  // Construction is deferred rather than corrected: a table built against a
  // zero-size box lays its rows out against that, and redrawing afterwards does
  // not fully recover.
  if (!table.value) {
    build();
    laidOutAt = { width: box.width, height: box.height };
    return;
  }

  const wider = !laidOutAt || Math.abs(laidOutAt.width - box.width) >= 0.5;
  const taller = !laidOutAt || Math.abs(laidOutAt.height - box.height) >= 0.5;
  if (!wider && !taller) return;

  laidOutAt = { width: box.width, height: box.height };

  /*
   * Deferred to the end of the run, not done on every frame of it.
   *
   * Collapsing the sidebar animates a width for a quarter of a second, and the
   * observer reports every frame of it. Answering each one dropped the window
   * to about five frames a second. Nothing in that quarter second is worth
   * looking at — the reader is watching a panel move — so the work waits until
   * the size stops changing and then happens once.
   *
   * And it is no longer a relayout. Columns keep the widths they were measured
   * at; a wider pane only means the last one has more room to take.
   */
  clearTimeout(queued);
  queued = window.setTimeout(() => {
    if (!table.value) return;
    if (wider) restretch();

    /*
     * A width change needs no redraw at all. The rows do not depend on how wide
     * the pane is — the columns carry their own widths and the pane simply
     * shows more or less of them — so the only thing a wider pane changes is
     * how much slack the last column can take, which `restretch` sets directly.
     *
     * Height is different: the virtual renderer decides how many rows to draw
     * from the height it has, so a taller pane has to be given the rows that
     * now fit in it.
     */
    if (taller) {
      table.value.redraw(false);
      countRedraw();
    }
  }, SETTLE);
}

onMounted(() => {
  if (visible()) build();

  observer = new ResizeObserver(() => redraw());
  if (container.value) observer.observe(container.value);
});

/** Drops the table and everything bound to it, leaving the container empty. */
function teardown(): void {
  laidOutAt = undefined;
  if (scroller && syncHeader) scroller.removeEventListener('scroll', syncHeader);
  scroller = undefined;
  syncHeader = undefined;
  table.value?.destroy();
  table.value = undefined;
}

onBeforeUnmount(() => {
  clearTimeout(queued);
  teardown();
  observer?.disconnect();
  observer = undefined;
});

/*
 * Two preferences are read when the table is constructed rather than per cell,
 * so the table is rebuilt when they change. Heavy-handed for something nobody
 * changes twice — but a preference that only takes effect in tabs opened
 * afterwards is the kind of thing people report as not working at all.
 */
watch(
  () => [settings.values.editTrigger, settings.values.binaryEncoding],
  () => {
    teardown();
    redraw();
  }
);

/* The gutter's formatter reads the base, so this only has to re-run it — which
   is what a plain redraw does. The forced one would refit every column. */
watch(
  () => settings.values.rowIndexBase,
  () => {
    table.value?.redraw(false);
    countRedraw();
  }
);

defineExpose({ redraw });

// Replacing the columns rebuilds the header, so it is only done when the shape
// actually changed — re-running it on every page of the same table would reset
// the user's column widths.
// Data that arrives before the table exists is not lost: `build()` reads the
// current props, so the deferred construction picks it up.
watch(
  () => props.fields,
  (fields) => {
    // A new shape is a new measurement; the same shape keeps whatever widths
    // the reader has dragged the columns to.
    void table.value?.setColumns(
      columnsFor(fields, measureColumns(fields, props.rows as Row[]))
    );
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
    <!-- One span whose only job is to be the shape of a cell's text. -->
    <span
      ref="probe"
      class="grid__probe"
      aria-hidden="true"
    />

    <div
      ref="container"
      class="grid"
    />
    <!--
      A veil alone said nothing. It dimmed the previous page by a few per cent
      and left the window looking exactly like one that had finished, so a slow
      query was indistinguishable from a finished one. The bar is the part that
      says work is happening; the veil is only what stops the stale rows reading
      as the new ones.
    -->
    <ProgressBar
      v-if="loading"
      class="grid__progress"
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
/* Over the header, where the eye already is when a page is being fetched. */
/*
 * Wears what a cell wears, so the width measurement is taken against the face
 * that will actually draw the text. Density and a larger OS text size come
 * along for free, which is the point of measuring rather than assuming.
 */
.grid__probe {
  position: absolute;
  top: 0;
  left: 0;
  visibility: hidden;
  pointer-events: none;
  white-space: pre;
  font-family: var(--font-mono);
  font-size: var(--grid-font);
  font-weight: 500;
}

.grid__progress {
  position: absolute;
  inset-inline: 0;
  top: 0;
  z-index: 4;
}

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
