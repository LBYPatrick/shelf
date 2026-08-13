import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseDelimited, parseJsonRows } from '@shared/csv';

describe('delimited text', () => {
  it('reads a plain file', () => {
    const table = parseDelimited('id,name\n1,alpha\n2,beta');
    expect(table.header).toEqual(['id', 'name']);
    expect(table.rows).toEqual([
      ['1', 'alpha'],
      ['2', 'beta'],
    ]);
  });

  it('keeps a delimiter that is inside a quoted field', () => {
    const table = parseDelimited('id,name\n1,"be,ta"');
    expect(table.rows[0]).toEqual(['1', 'be,ta']);
  });

  it('keeps a newline that is inside a quoted field', () => {
    const table = parseDelimited('id,note\n1,"line one\nline two"\n2,x');
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]![1]).toBe('line one\nline two');
  });

  it('unescapes a doubled quote', () => {
    expect(parseDelimited('a\n"say ""hi"""').rows[0]).toEqual(['say "hi"']);
  });

  it('handles CRLF line endings and a byte order mark', () => {
    const table = parseDelimited('﻿id,name\r\n1,alpha\r\n');
    expect(table.header).toEqual(['id', 'name']);
    expect(table.rows).toEqual([['1', 'alpha']]);
  });

  it('detects tabs and semicolons', () => {
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('a;b;c')).toBe(';');
    expect(detectDelimiter('a,b,c')).toBe(',');
  });

  it('is not fooled into picking a delimiter that only appears inside quotes', () => {
    expect(detectDelimiter('id;"a,b,c,d";x')).toBe(';');
  });

  it('keeps empty trailing fields', () => {
    expect(parseDelimited('a,b,c\n1,,').rows[0]).toEqual(['1', '', '']);
  });

  it('returns an empty table for empty input', () => {
    expect(parseDelimited('').header).toEqual([]);
  });
});

describe('json rows', () => {
  it('unions the keys across every object', () => {
    const table = parseJsonRows('[{"a":1},{"b":2}]');
    expect(table.header).toEqual(['a', 'b']);
    expect(table.rows).toEqual([
      ['1', ''],
      ['', '2'],
    ]);
  });

  it('serialises nested values rather than losing them', () => {
    expect(parseJsonRows('[{"a":{"x":1}}]').rows[0]).toEqual(['{"x":1}']);
  });

  it('accepts a single object as one row', () => {
    expect(parseJsonRows('{"a":1}').rows).toHaveLength(1);
  });
});
