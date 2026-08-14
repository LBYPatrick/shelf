import { describe, expect, it } from 'vitest';
import type { CellValue, Field } from '@drivers/types';
import { toDelimited, toJson, toMarkdown } from '@shared/tabular';

const field = (name: string, dataType?: string): Field =>
  dataType === undefined ? { name } : { name, dataType };

/*
 * Tagged values are the whole point of these tests. A date, a bigint, a blob
 * and a JSON column all arrive at the renderer wrapped in a transport envelope,
 * and every one of them used to be pasted as that envelope — `{"$":"date",…}`
 * in the cell where the date should be.
 */
const TAGGED: Record<string, CellValue> = {
  released: { $: 'date', data: '2012-04-24T00:00:00.000Z' },
  seen: { $: 'date', data: '2012-04-24T14:30:05.250Z' },
  plays: { $: 'bigint', data: '9007199254740993' },
  meta: { $: 'json', data: '{"a":1}' },
};

const COLUMNS = [
  field('released', 'date'),
  field('seen', 'timestamptz'),
  field('plays', 'bigint'),
  field('meta', 'jsonb'),
];

describe('delimited text', () => {
  it('unwraps a tagged value instead of pasting its envelope', () => {
    const csv = toDelimited(COLUMNS, [TAGGED], ',');
    const [header, row] = csv.split('\n');

    expect(header).toBe('released,seen,plays,meta');
    expect(row).toBe('2012-04-24,2012-04-24 14:30:05.250,9007199254740993,"{""a"":1}"');
    expect(csv).not.toContain('"$"');
  });

  it('quotes a field holding the delimiter, a quote or a newline', () => {
    const rows = [{ a: 'be,ta', b: 'say "hi"', c: 'two\nlines' }];
    const csv = toDelimited([field('a'), field('b'), field('c')], rows, ',');

    expect(csv.split('\n')[1]).toBe('"be,ta","say ""hi""","two');
    expect(csv).toContain('lines"');
  });

  it('applies the same rule to tabs', () => {
    const csv = toDelimited([field('a')], [{ a: 'x\ty' }], '\t');
    expect(csv.split('\n')[1]).toBe('"x\ty"');
  });

  it('writes an absent column as empty rather than undefined', () => {
    expect(toDelimited([field('missing')], [{}], ',').split('\n')[1]).toBe('');
  });
});

describe('json', () => {
  it('unwraps tags but keeps native shapes native', () => {
    const parsed = JSON.parse(
      toJson(
        [...COLUMNS, field('rating'), field('gone')],
        [{ ...TAGGED, rating: 4.5, gone: null }]
      )
    ) as Record<string, unknown>[];

    expect(parsed[0]).toEqual({
      released: '2012-04-24',
      seen: '2012-04-24 14:30:05.250',
      plays: '9007199254740993',
      meta: '{"a":1}',
      rating: 4.5,
      gone: null,
    });
  });
});

describe('markdown', () => {
  it('pads every column to its widest cell', () => {
    const lines = toMarkdown(
      [field('id'), field('name')],
      [{ id: 1, name: 'Talk Talk' }]
    ).split('\n');

    expect(lines[0]).toBe('| id  | name      |');
    expect(lines[1]).toBe('| --- | --------- |');
    expect(lines[2]).toBe('| 1   | Talk Talk |');
  });

  it('escapes a pipe and flattens a newline so the table survives', () => {
    const lines = toMarkdown([field('v')], [{ v: 'a|b\nc' }]).split('\n');
    expect(lines[2]).toBe('| a\\|b c |');
  });

  it('unwraps a tagged value here too', () => {
    expect(toMarkdown([field('released', 'date')], [TAGGED])).toContain('2012-04-24 ');
  });
});
