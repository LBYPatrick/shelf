import type { CellValue, TaggedValue } from '../drivers/types';

/**
 * Presenting a cell value.
 *
 * This lives in shared code, not in the driver layer, because the renderer must
 * be able to format a value without importing anything Node-side. It uses only
 * browser primitives — no Buffer — so the same function works on both sides of
 * the process boundary.
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

/** The text shown in a grid cell, and copied to the clipboard. */
export function displayValue(value: CellValue, encoding: BinaryEncoding = 'hex'): string {
  if (value === null || value === undefined) return '';
  if (!isTagged(value)) return String(value);

  switch (value.$) {
    case 'binary':
      return encoding === 'hex' ? `0x${base64ToHex(value.data)}` : value.data;
    case 'date':
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
