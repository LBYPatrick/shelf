import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Cursor, Field, Row } from '@drivers/types';
import { defaultJobName } from '@renderer/stores/jobs';
import { readSpoolPage, spool } from '@utility/spool';

describe('naming a dispatched job', () => {
  it('is the database and the moment, largest field first', () => {
    expect(defaultJobName('production', new Date(2026, 7, 19, 9, 4, 5))).toBe(
      'production-20260819-090405'
    );
  });

  it('pads every field, so names of the same day sort as text', () => {
    const early = defaultJobName('db', new Date(2026, 0, 2, 3, 4, 5));
    const later = defaultJobName('db', new Date(2026, 0, 2, 13, 4, 5));
    expect(early).toBe('db-20260102-030405');
    expect([later, early].sort()).toEqual([early, later]);
  });

  it('falls back to a name rather than starting with a dash', () => {
    expect(defaultJobName('', new Date(2026, 7, 19, 9, 0, 0))).toBe('query-20260819-090000');
  });
});

/**
 * A cursor that does not know its own columns until it has fetched something,
 * which is how the Postgres one behaves: the field list comes off the first
 * result, so it is empty right up until the first `read` returns.
 */
function lateCursor(batches: readonly (readonly Row[])[], fields: readonly Field[]): Cursor {
  let index = 0;
  let known: readonly Field[] = [];

  return {
    get fields() {
      return known;
    },
    async read() {
      const batch = batches[index] ?? [];
      index += 1;
      if (batch.length > 0) known = fields;
      return batch;
    },
    async close() {},
  } as Cursor;
}

describe('spooling a dispatched job', () => {
  it('records the columns the cursor only learned on its first read', async () => {
    /*
     * Written before the first read, the header said `{"fields":[]}` for every
     * dispatched Postgres query — so the job tab drew a hundred rows with no
     * columns to put them in, and the export wrote a file with none either.
     */
    const directory = await mkdtemp(join(tmpdir(), 'shelf-spool-'));
    const path = join(directory, 'job.jsonl');

    try {
      const rows = [{ id: 1, name: 'one' }] as unknown as readonly Row[];
      const result = await spool(
        lateCursor([rows, []], [{ name: 'id' }, { name: 'name' }]),
        path
      );

      expect(result.rows).toBe(1);

      const [header] = (await readFile(path, 'utf8')).split('\n');
      expect(JSON.parse(header!)).toEqual({ fields: [{ name: 'id' }, { name: 'name' }] });

      const page = await readSpoolPage(path, 0, 10);
      expect(page.fields).toEqual([{ name: 'id' }, { name: 'name' }]);
      expect(page.rows).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('still describes itself when the statement matched nothing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shelf-spool-'));
    const path = join(directory, 'empty.jsonl');

    try {
      await spool(lateCursor([[]], [{ name: 'id' }]), path);
      const page = await readSpoolPage(path, 0, 10);
      expect(page.rows).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
