import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import type { Cursor, Field, Row } from '@drivers/types';
import { displayValue } from '@shared/values';

/**
 * Exporting.
 *
 * This runs inside the connection host and writes straight to disk. The cursor
 * never crosses a process boundary and the rows are never accumulated, so
 * exporting ten million rows costs the same memory as exporting ten.
 */

export type ExportFormat = 'csv' | 'json' | 'jsonl' | 'sql';

export interface ExportRequest {
  readonly format: ExportFormat;
  readonly path: string;
  /** Table name used for the INSERT statements of a SQL export. */
  readonly table?: string;
  readonly chunkSize: number;
}

export interface ExportProgress {
  readonly rowsWritten: number;
  readonly done: boolean;
  readonly error?: string;
}

/** RFC 4180: quote when the value could otherwise be misread, and double quotes. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.split('"').join('""')}"` : value;
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return `'${String(value).split("'").join("''")}'`;
}

function renderRow(
  row: Row,
  fields: readonly Field[],
  request: ExportRequest,
  first: boolean
): string {
  switch (request.format) {
    case 'csv':
      return `${fields.map((field) => csvCell(displayValue(row[field.name] ?? null))).join(',')}\n`;

    case 'jsonl':
      return `${JSON.stringify(plain(row, fields))}\n`;

    case 'json':
      // Written incrementally rather than serialising the whole array, so a
      // large export never has to fit in memory as one string.
      return `${first ? '' : ',\n'}  ${JSON.stringify(plain(row, fields))}`;

    case 'sql': {
      const columns = fields.map((field) => `"${field.name}"`).join(', ');
      const values = fields
        .map((field) => sqlLiteral(displayValue(row[field.name] ?? null) || null))
        .join(', ');
      return `INSERT INTO "${request.table ?? 'exported'}" (${columns}) VALUES (${values});\n`;
    }
  }
}

function plain(row: Row, fields: readonly Field[]): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const field of fields) {
    const value = row[field.name];
    result[field.name] = value === null || value === undefined ? null : displayValue(value);
  }
  return result;
}

/**
 * Streams a cursor to a file, reporting progress as it goes.
 *
 * Backpressure is honoured: when the file stream's buffer is full we wait for
 * it to drain before reading more, which is what stops a fast database from
 * filling memory faster than the disk can take it.
 */
export async function runExport(
  cursor: Cursor,
  request: ExportRequest,
  onProgress: (progress: ExportProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const stream = createWriteStream(request.path, { encoding: 'utf8' });

  let written = 0;
  let first = true;

  async function write(text: string): Promise<void> {
    if (!stream.write(text)) await once(stream, 'drain');
  }

  try {
    /*
     * The first batch is read *before* anything is written, because a cursor
     * does not know the shape of its result until the server has answered one.
     * Reading `cursor.fields` up front got an empty array from every driver
     * that learns its columns from the first batch — so the CSV header was a
     * blank line and every row rendered as `fields.map(...)` over nothing. The
     * export "succeeded", reported its row count, and wrote a file of empty
     * lines.
     */
    let chunk = await cursor.read();
    const fields = cursor.fields;

    if (request.format === 'csv') {
      await write(`${fields.map((field) => csvCell(field.name)).join(',')}\n`);
    } else if (request.format === 'json') {
      await write('[\n');
    }

    while (chunk.length > 0) {
      for (const row of chunk) {
        await write(renderRow(row, fields, request, first));
        first = false;
        written += 1;
      }

      onProgress({ rowsWritten: written, done: false });
      if (signal?.aborted) break;
      chunk = await cursor.read();
    }

    if (request.format === 'json') await write('\n]\n');

    await new Promise<void>((resolve, reject) => {
      stream.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });

    onProgress({ rowsWritten: written, done: true });
  } catch (error) {
    stream.destroy();
    onProgress({
      rowsWritten: written,
      done: true,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await cursor.close().catch(() => undefined);
  }
}
