/**
 * How wide a column has to be, worked out without touching the layout.
 *
 * Tabulator's `fitData` family sizes a column by clearing its width and then
 * reading `offsetWidth` off every cell it has — a forced reflow per cell, and
 * `fitDataStretch` does it for every column on *every* layout rather than only
 * when asked. Dragging the sidebar re-measured the whole grid on every pointer
 * move; switching to a tab did it twice; a page of a few hundred rows across a
 * few dozen columns is tens of thousands of forced reflows, and the window
 * stopped for each one.
 *
 * Text measured in a canvas costs nothing in layout: the browser is asked how
 * wide a string is, not how wide a box turned out. A sample is enough — the
 * widest of two hundred rows is within a character of the widest of fifty
 * thousand, and the column is resizable either way.
 */

/** Rows sampled per column. Beyond this the answer stops changing. */
const SAMPLE = 200;

/** Cell padding, the sort order arrow, and a character of slack. */
const CHROME = 26;

let context: CanvasRenderingContext2D | null | undefined;

function measurer(): CanvasRenderingContext2D | null {
  if (context === undefined) {
    context = document.createElement('canvas').getContext('2d');
  }
  return context;
}

/**
 * The CSS `font` shorthand for an element, which is what canvas wants.
 *
 * Read from a real element rather than assembled from tokens, so the density
 * scale and a larger OS text size are already in it.
 */
export function fontOf(element: Element): string {
  const style = getComputedStyle(element);
  return `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

/**
 * How wide a string is, without putting it on the page.
 *
 * The same canvas the grid measures with. Anything laying text out by hand —
 * an SVG node that has to be wide enough for its own label — needs this rather
 * than a guess at an average character, because a guess is wrong by a whole
 * word on the strings that matter: the long ones.
 */
export function textWidth(text: string, font: string): number {
  const ctx = measurer();
  if (!ctx) return text.length * 7;
  ctx.font = font;
  return ctx.measureText(text).width;
}

export interface WidthOptions {
  readonly font: string;
  /** Header labels are set in the UI face, the values in the monospace one. */
  readonly headerFont?: string;
  readonly min: number;
  readonly max: number;
}

/**
 * A width for each column, from its heading and a sample of its values.
 *
 * `text` returns what a cell will actually show, which is not the raw value: a
 * buffer renders as hex, a date as a shortened instant, and a null as the word.
 */
export function columnWidths<T>(
  fields: readonly string[],
  rows: readonly T[],
  text: (row: T, field: string) => string,
  options: WidthOptions
): Map<string, number> {
  const widths = new Map<string, number>();
  const ctx = measurer();

  const sample = rows.length > SAMPLE ? rows.slice(0, SAMPLE) : rows;

  for (const field of fields) {
    if (!ctx) {
      widths.set(field, options.min);
      continue;
    }

    ctx.font = options.headerFont ?? options.font;
    let widest = ctx.measureText(field).width;

    ctx.font = options.font;
    for (const row of sample) {
      const width = ctx.measureText(text(row, field)).width;
      if (width > widest) widest = width;
    }

    widths.set(field, Math.min(options.max, Math.max(options.min, Math.ceil(widest) + CHROME)));
  }

  return widths;
}

/**
 * Widens the last column so the row reaches the right edge.
 *
 * This is what `fitDataStretch` was being kept for, and it is one subtraction
 * rather than a re-measurement of the whole table. A table already wider than
 * its pane is left alone — it scrolls.
 */
export function stretchLast(
  widths: Map<string, number>,
  order: readonly string[],
  available: number
): void {
  const last = order[order.length - 1];
  if (last === undefined) return;

  let total = 0;
  for (const field of order) total += widths.get(field) ?? 0;

  const slack = available - total;
  if (slack > 0) widths.set(last, (widths.get(last) ?? 0) + slack);
}
