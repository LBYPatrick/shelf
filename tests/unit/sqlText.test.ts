import { describe, expect, it } from 'vitest';
import { formatterDialect, statementAt } from '@shared/sqlText';

/** The statement the cursor sits in, for a cursor placed at `|`. */
const at = (marked: string) => {
  const position = marked.indexOf('|');
  return statementAt(marked.replace('|', ''), position).text;
};

describe('finding the statement under the cursor', () => {
  it('returns the whole thing when there is only one', () => {
    expect(at('SELECT 1|')).toBe('SELECT 1');
  });

  it('picks the one the cursor is in, not the first', () => {
    // The terminator comes with it: what gets run is a whole statement.
    expect(at('SELECT 1; SELECT |2; SELECT 3')).toBe('SELECT 2;');
    expect(at('SELECT 1; SELECT 2; SELECT |3')).toBe('SELECT 3');
  });

  /*
   * The whole reason this is hand-written rather than a `split(';')`. Getting
   * any of these wrong means running half a statement, which for a DELETE is
   * the difference between a filter and a table.
   */
  it('does not treat a semicolon inside a string as a boundary', () => {
    expect(at("DELETE FROM t WHERE name = 'a;b'| AND id > 1")).toBe(
      "DELETE FROM t WHERE name = 'a;b' AND id > 1"
    );
  });

  it('ignores one inside a quoted identifier', () => {
    expect(at('SELECT "we;ird"| FROM t')).toBe('SELECT "we;ird" FROM t');
  });

  it('ignores one inside a line comment', () => {
    expect(at('SELECT 1 -- a; b\nFROM t|')).toBe('SELECT 1 -- a; b\nFROM t');
  });

  it('ignores one inside a block comment', () => {
    expect(at('SELECT /* a; b */ 1| FROM t')).toBe('SELECT /* a; b */ 1 FROM t');
  });

  it('trims the leading whitespace off the range it reports', () => {
    const found = statementAt('SELECT 1;\n\n  SELECT 2', 15);
    expect(found.text).toBe('SELECT 2');
    // The offsets must land on the statement, not on the blank lines before it,
    // or the editor marks two empty rows above what it claims to be running.
    expect(found.from).toBe(13);
    expect(found.to).toBe(21);
  });

  /*
   * A cursor resting immediately after a semicolon still belongs to the
   * statement it terminates. The alternative — nothing selected the moment you
   * finish typing one — would disable "run current" at exactly the point you
   * reach for it.
   */
  it('keeps the statement when the cursor sits just past its semicolon', () => {
    expect(at('SELECT 1;|')).toBe('SELECT 1;');
  });

  it('has nothing to report for an empty document', () => {
    expect(at('|')).toBe('');
    expect(at('   |  ')).toBe('');
  });

  it('survives an unterminated string rather than losing the rest', () => {
    expect(at("SELECT 'unclosed| FROM t")).toBe("SELECT 'unclosed FROM t");
  });
});

describe('choosing a dialect for the formatter', () => {
  it('gives Postgres its own, so casts and JSON operators parse', () => {
    expect(formatterDialect('postgres')).toBe('postgresql');
  });

  it('sends the MySQL-compatible engines to their own grammars', () => {
    expect(formatterDialect('mysql')).toBe('mysql');
    expect(formatterDialect('tidb')).toBe('tidb');
  });

  it('falls back to ANSI for anything with no dialect of its own', () => {
    expect(formatterDialect('mongodb')).toBe('sql');
    expect(formatterDialect(undefined)).toBe('sql');
  });
});
