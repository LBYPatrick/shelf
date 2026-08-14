import type { CellValue, TaggedValue } from '../drivers/types';

/**
 * Presenting a cell value.
 *
 * This lives in shared code, not in the driver layer, because the renderer must
 * be able to format a value without importing anything Node-side. It uses only
 * browser primitives — no Buffer — so the same function works on both sides of
 * the process boundary.
 *
 * It is also the *only* place a value becomes text. The clipboard used to have
 * its own idea of that, which is why a date column pasted as
 * `{"$":"date","data":"…"}` — the tag is a transport detail, and anything that
 * renders it has forgotten to unwrap the value.
 */

export type BinaryEncoding = 'hex' | 'base64';

export function isTagged(value: unknown): value is TaggedValue {
  return typeof value === 'object' && value !== null && '$' in value;
}

function base64ToHex(base64: string): string {
  const binary = atob(base64);
  let hex = '';
  for (let index = 0; index < binary.length; index += 1) {
    hex += binary.charCodeAt(index).toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * An instant, in the shape the column actually holds.
 *
 * Dates cross the process boundary as a full ISO instant because that is the
 * only lossless way to move one. Rendering them in that form spends 24
 * characters of column width on 10 characters of information and puts a `T` and
 * a `Z` in front of the eye on every row of the grid.
 *
 * `dateOnly` is decided per column rather than per value: a column whose
 * timestamps happened to fall on midnight would otherwise render narrow on some
 * rows and wide on others, and a column that changes width as you page through
 * it is worse than a wide one.
 */
export function formatInstant(iso: string, dateOnly = false): string {
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d+)?Z$/.exec(iso);
  // Anything that is not the shape the transcoder writes is shown verbatim,
  // because a value we cannot parse is not a value we should be rewriting.
  if (!parts) return iso;

  const [, day, time, fraction] = parts;
  if (dateOnly) return day!;
  return `${day} ${time}${fraction === '.000' ? '' : (fraction ?? '')}`;
}

/** Declared column types that carry a day and no time of day. */
export function isDateOnly(dataType: string | undefined): boolean {
  return dataType !== undefined && /^date$/i.test(dataType.trim());
}

export interface DisplayOptions {
  readonly encoding?: BinaryEncoding;
  /** The column's declared type, which decides how an instant is written. */
  readonly dataType?: string;
}

/** The text shown in a grid cell, written to a file, and copied to the clipboard. */
export function displayValue(value: CellValue, options: DisplayOptions = {}): string {
  if (value === null || value === undefined) return '';
  if (!isTagged(value)) return String(value);

  switch (value.$) {
    case 'binary':
      return options.encoding === 'base64' ? value.data : `0x${base64ToHex(value.data)}`;
    case 'date':
      return formatInstant(value.data, isDateOnly(options.dataType));
    case 'bigint':
    case 'objectid':
    case 'json':
      return value.data;
  }
}

/**
 * A short label for the kind of value, used where the type matters more than
 * the content — a 40MB blob should say what it is rather than try to render.
 */
export function valueKind(value: CellValue): string {
  if (value === null) return 'null';
  if (!isTagged(value)) return typeof value;
  return value.$;
}
