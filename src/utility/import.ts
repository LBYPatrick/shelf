import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { parseDelimited, parseJsonRows, type DelimitedTable } from '@shared/csv';

/**
 * Reading an import file.
 *
 * The whole file is read at once, which is the honest trade for this feature:
 * imports are normally thousands of rows, not millions, and streaming a CSV
 * that may contain quoted newlines correctly is a great deal of machinery for a
 * case the export side already covers. If that stops being true, this is the
 * one function to change.
 */
export async function readTable(path: string): Promise<DelimitedTable> {
  const text = await readFile(path, 'utf8');
  const extension = extname(path).toLowerCase();

  if (extension === '.json') return parseJsonRows(text);

  if (extension === '.jsonl' || extension === '.ndjson') {
    const rows = text
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as unknown);
    return parseJsonRows(JSON.stringify(rows));
  }

  return parseDelimited(text);
}

/** An empty cell means NULL, not the empty string — a blank in a CSV is absence. */
export function cellToValue(cell: string): string | null {
  return cell === '' ? null : cell;
}
