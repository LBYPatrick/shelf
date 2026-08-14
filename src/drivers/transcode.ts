import { isTagged } from '../shared/values';
import type { CellValue, Field, Row } from './types';

export { displayValue, isTagged } from '../shared/values';

/**
 * Values that cannot survive the trip between processes.
 *
 * A structured clone will happily carry a Buffer, but it arrives as a Uint8Array
 * the grid cannot tell apart from an array of numbers; a BigInt throws outright
 * when the transport falls back to JSON; a Mongo ObjectId arrives as a plain
 * object with its class gone. So anything whose *identity* matters is tagged on
 * the way out and rebuilt on the way in.
 *
 * The tag also tells the grid how to render the value, which is why it is worth
 * carrying even for types that would technically survive.
 */

const BINARY_PREVIEW_LIMIT = 1024 * 64;

/** Convert a driver-native value into something safe to send. */
export function encodeValue(value: unknown): CellValue {
  if (value === null || value === undefined) return null;

  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return value as CellValue;
    case 'bigint':
      // Precision beyond 2^53 is exactly why the column is a bigint; keeping it
      // as text preserves the value the database actually holds.
      return { $: 'bigint', data: value.toString() };
    default:
      break;
  }

  if (value instanceof Date) {
    return { $: 'date', data: value.toISOString() };
  }

  if (value instanceof Uint8Array) {
    // Very large blobs are truncated for display; the full value is fetched on
    // demand rather than shipped with every page of the grid.
    const slice =
      value.byteLength > BINARY_PREVIEW_LIMIT ? value.subarray(0, BINARY_PREVIEW_LIMIT) : value;
    return { $: 'binary', data: Buffer.from(slice).toString('base64') };
  }

  // Mongo ObjectIds and similar wrappers identify themselves structurally.
  const candidate = value as { _bsontype?: string; toHexString?: () => string };
  if (candidate._bsontype === 'ObjectId' && typeof candidate.toHexString === 'function') {
    return { $: 'objectid', data: candidate.toHexString() };
  }

  // Anything else structural travels as JSON text, which is also how the grid
  // and the inspector want to display it.
  try {
    return { $: 'json', data: JSON.stringify(value) };
  } catch {
    return String(value);
  }
}

/** Rebuild a value the renderer received, for display or for sending back. */
export function decodeValue(value: CellValue): unknown {
  if (!isTagged(value)) return value;

  switch (value.$) {
    case 'bigint':
      return BigInt(value.data);
    case 'date':
      return new Date(value.data);
    case 'binary':
      return Buffer.from(value.data, 'base64');
    case 'objectid':
    case 'json':
      return value.data;
  }
}

export function encodeRow(row: Record<string, unknown>): Row {
  const encoded: Record<string, CellValue> = {};
  for (const [key, value] of Object.entries(row)) {
    encoded[key] = encodeValue(value);
  }
  return encoded;
}

export function encodeRows(rows: readonly Record<string, unknown>[]): Row[] {
  return rows.map(encodeRow);
}

/**
 * Infer the tag for each field from the first row that has a non-null value, so
 * the grid can choose a renderer before the user scrolls into the data.
 */
export function tagFields(
  fields: readonly Omit<Field, 'tag'>[],
  rows: readonly Row[]
): Field[] {
  return fields.map((field) => {
    for (const row of rows) {
      const value = row[field.name];
      if (isTagged(value)) return { ...field, tag: value.$ };
      if (value !== null && value !== undefined) break;
    }
    return { ...field };
  });
}

/**
 * A tagged value, back to the scalar the driver should write.
 *
 * The inverse of `encodeValue` for the drivers that hand values straight to a
 * client library rather than to a parameterised statement. Three of them had
 * written their own identical copy of this at the bottom of the file.
 */
export function untagValue(value: unknown): unknown {
  return isTagged(value) ? value.data : value;
}
