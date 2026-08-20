import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Cursor, Field, Row } from '@drivers/types';

/**
 * A dispatched query's whole answer, on disk.
 *
 * This is the difference between running a statement and dispatching one. A run
 * fetches a page so you can look at it, which is why it carries a limit; a
 * dispatch is asked for because the answer is the point — you want all of it,
 * and you are going to export it. Holding a million rows in the interface to
 * make that possible is not an option, and re-running the statement at export
 * time is the thing dispatching exists to avoid: the second run is another few
 * minutes of the server's time, and it can return something different.
 *
 * So the rows go straight from the cursor to a file, and everything afterwards
 * — paging through them, writing them out in any format — reads that file. The
 * interface holds one page at a time and the export is a copy.
 *
 * JSON Lines, because it is the only shape that can be *appended* without
 * rewriting what came before and *read* without parsing what you are skipping.
 * The first line is the field list, so a spool describes itself.
 */

/** Where spools live. One directory so an orphan is easy to find and sweep. */
export function spoolDirectory(): string {
  return join(tmpdir(), 'shelf-jobs');
}

export function spoolPath(jobId: string): string {
  return join(spoolDirectory(), `${jobId}.jsonl`);
}

export interface SpoolResult {
  readonly rows: number;
  readonly fields: readonly Field[];
  readonly bytes: number;
}

/**
 * Drains a cursor into a spool file.
 *
 * Back-pressure is respected rather than assumed: `write` returning false means
 * the kernel buffer is full, and a loop that ignores it turns a bounded-memory
 * copy into an unbounded one — the whole result set queued inside the stream,
 * which is exactly what this exists to avoid.
 */
export async function spool(
  cursor: Cursor,
  path: string,
  onProgress?: (rows: number) => void,
  signal?: AbortSignal
): Promise<SpoolResult> {
  await mkdir(spoolDirectory(), { recursive: true });

  const file = createWriteStream(path, { encoding: 'utf8' });
  let rows = 0;

  const put = async (line: string): Promise<void> => {
    if (!file.write(line)) await once(file, 'drain');
  };

  /*
   * The header is written after the first batch, not before it.
   *
   * A cursor does not necessarily know its own columns until it has fetched
   * something: Postgres learns them from the first result, so `cursor.fields`
   * is empty until `read` has returned once. Writing the header first therefore
   * recorded `{"fields":[]}` for every dispatched Postgres query — and since
   * the spool is what the job tab and the export both read, the answer came
   * back as a hundred rows with no columns to put them in, and the exported
   * file had no columns either. The rows are unaffected either way, so the only
   * cost of waiting is that the file describes itself accurately.
   */
  let described = false;
  const describe = async (): Promise<void> => {
    if (described) return;
    described = true;
    await put(`${JSON.stringify({ fields: cursor.fields })}\n`);
  };

  try {
    for (;;) {
      if (signal?.aborted) throw new Error('Cancelled.');

      const batch = await cursor.read();
      if (batch.length === 0) break;

      await describe();
      for (const row of batch) await put(`${JSON.stringify(row)}\n`);

      rows += batch.length;
      onProgress?.(rows);
    }

    // A statement that matched nothing still has columns, and a spool with no
    // first line is a file the reader cannot tell from a truncated one.
    await describe();
  } finally {
    await cursor.close().catch(() => undefined);
    file.end();
    await once(file, 'finish').catch(() => undefined);
  }

  const { size } = await stat(path).catch(() => ({ size: 0 }));
  return { rows, fields: cursor.fields, bytes: size };
}

export interface SpoolPage {
  readonly fields: readonly Field[];
  readonly rows: readonly Row[];
}

/**
 * One page out of a spool.
 *
 * Read line by line and skipped rather than seeked, because a JSON Lines file
 * has no fixed record length and an index would be a second file to keep
 * consistent with the first. Skipping costs a scan of the bytes before the
 * page, and *only* the page is parsed — which is the expensive half. At the
 * sizes a person pages through by hand this is not the slow part; the slow part
 * was the query, and it has already happened.
 */
export async function readSpoolPage(
  path: string,
  offset: number,
  limit: number
): Promise<SpoolPage> {
  const reader = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let fields: readonly Field[] = [];
  const rows: Row[] = [];
  let index = -1;

  try {
    for await (const line of reader) {
      index += 1;

      if (index === 0) {
        fields = (JSON.parse(line) as { fields: readonly Field[] }).fields;
        continue;
      }

      const position = index - 1;
      if (position < offset) continue;
      if (rows.length >= limit) break;

      rows.push(JSON.parse(line) as Row);
    }
  } finally {
    reader.close();
  }

  return { fields, rows };
}

/**
 * Every row of a spool, handed over a batch at a time.
 *
 * The same shape a driver's cursor has, so writing a spool to a file and
 * writing a *query* to a file are the same code path — see `runExport`.
 */
export function spoolCursor(path: string, chunkSize: number): Promise<Cursor> {
  const reader = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  const iterator = reader[Symbol.asyncIterator]();

  return (async () => {
    const first = await iterator.next();
    const fields = first.done
      ? []
      : (JSON.parse(first.value as string) as { fields: readonly Field[] }).fields;

    let exhausted = false;

    return {
      fields,
      async read(): Promise<readonly Row[]> {
        if (exhausted) return [];

        const batch: Row[] = [];
        while (batch.length < chunkSize) {
          const next = await iterator.next();
          if (next.done) {
            exhausted = true;
            break;
          }
          batch.push(JSON.parse(next.value as string) as Row);
        }
        return batch;
      },
      async close(): Promise<void> {
        reader.close();
      },
    };
  })();
}

/** Removes a spool, and says nothing if it was already gone. */
export async function discardSpool(path: string): Promise<void> {
  await unlink(path).catch(() => undefined);
}
