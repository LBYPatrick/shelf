import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Cursor, Field, Row } from '@drivers/types';
import { runExport } from '../../src/utility/export';

/**
 * A cursor that only learns its columns from the first batch.
 *
 * This is not a contrivance: it is what `pg-cursor` does, and what the SQLite
 * and DuckDB cursors do — the result's shape comes back with the first rows
 * and not before. Reading `cursor.fields` before the first `read()` is the bug
 * this file exists to keep fixed.
 */
function lateCursor(fields: readonly Field[], batches: readonly (readonly Row[])[]): Cursor {
  let discovered: readonly Field[] = [];
  let index = 0;

  return {
    get fields() {
      return discovered;
    },
    async read() {
      discovered = fields;
      return batches[index++] ?? [];
    },
    async close() {},
  };
}

const FIELDS: Field[] = [{ name: 'id' }, { name: 'title' }];
const ROWS: Row[] = [
  { id: 1, title: 'Talk Talk' },
  { id: 2, title: 'Slow, and "quoted"' },
];

let dir = '';
const noop = () => undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'shelf-export-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(format: 'csv' | 'json' | 'jsonl' | 'sql', cursor: Cursor) {
  const path = join(dir, `out.${format}`);
  await runExport(cursor, { format, path, chunkSize: 10, table: 'album' }, noop);
  return readFile(path, 'utf8');
}

describe('exporting a cursor that names its columns late', () => {
  it('writes a header and rows, not a file of blank lines', async () => {
    const text = await write('csv', lateCursor(FIELDS, [ROWS]));
    expect(text).toBe('id,title\n1,Talk Talk\n2,"Slow, and ""quoted"""\n');
  });

  it('names the keys in JSON', async () => {
    const text = await write('json', lateCursor(FIELDS, [ROWS]));
    expect(JSON.parse(text)).toEqual([
      { id: '1', title: 'Talk Talk' },
      { id: '2', title: 'Slow, and "quoted"' },
    ]);
  });

  it('names the keys in JSON Lines', async () => {
    const text = await write('jsonl', lateCursor(FIELDS, [ROWS]));
    expect(
      text
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    ).toEqual([
      { id: '1', title: 'Talk Talk' },
      { id: '2', title: 'Slow, and "quoted"' },
    ]);
  });

  it('names the columns in SQL', async () => {
    const text = await write('sql', lateCursor(FIELDS, [ROWS]));
    expect(text.split('\n')[0]).toBe(
      'INSERT INTO "album" ("id", "title") VALUES (\'1\', \'Talk Talk\');'
    );
  });

  it('reads every batch, not just the first', async () => {
    const text = await write('csv', lateCursor(FIELDS, [[ROWS[0]!], [ROWS[1]!]]));
    expect(text.trim().split('\n')).toHaveLength(3);
  });

  it('writes a header and nothing else for an empty result', async () => {
    const text = await write('csv', lateCursor(FIELDS, []));
    expect(text).toBe('id,title\n');
  });

  it('reports the rows it wrote', async () => {
    let last = 0;
    await runExport(
      lateCursor(FIELDS, [ROWS]),
      { format: 'csv', path: join(dir, 'count.csv'), chunkSize: 10 },
      (progress) => (last = progress.rowsWritten)
    );
    expect(last).toBe(2);
  });
});
