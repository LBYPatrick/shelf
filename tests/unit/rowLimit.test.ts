import { describe, expect, it } from 'vitest';
import { UNLIMITED, limitStatement } from '@shared/rowLimit';

describe('the preview limit', () => {
  it('asks the server for one more row than it means to show', () => {
    // The extra row is what makes "there were more" an observation rather than
    // a guess: a result of exactly 500 could be a limit or a whole table.
    expect(limitStatement('SELECT * FROM album', 500)).toBe('SELECT * FROM album\nLIMIT 501');
  });

  it('puts the limit on its own line, so a trailing comment cannot eat it', () => {
    const limited = limitStatement('SELECT * FROM album -- everything', 10);
    expect(limited.split('\n').at(-1)).toBe('LIMIT 11');
  });

  it('drops a trailing semicolon rather than limiting after it', () => {
    expect(limitStatement('SELECT 1;', 10)).toBe('SELECT 1\nLIMIT 11');
  });

  it('limits the statement forms that return rows', () => {
    for (const sql of [
      'SELECT 1',
      'with t as (select 1) select * from t',
      'VALUES (1)',
      'TABLE album',
    ]) {
      expect(limitStatement(sql, 5), sql).toContain('LIMIT 6');
    }
  });

  /*
   * Everything below returns the statement untouched, which is not a failure:
   * the driver still cuts the result to size afterwards. The only thing that
   * must never happen is a statement coming back that no longer runs.
   */
  it('leaves alone anything that does not return rows', () => {
    for (const sql of [
      'INSERT INTO t VALUES (1)',
      'UPDATE t SET a = 1',
      'CREATE TABLE t (a int)',
    ]) {
      expect(limitStatement(sql, 5), sql).toBe(sql);
    }
  });

  it('leaves alone a statement that states its own limit', () => {
    for (const sql of [
      'SELECT * FROM album LIMIT 3',
      'SELECT * FROM album OFFSET 10',
      'SELECT * FROM album FETCH FIRST 5 ROWS ONLY',
    ]) {
      expect(limitStatement(sql, 500), sql).toBe(sql);
    }
  });

  it('leaves alone a statement whose last clause has to stay last', () => {
    expect(limitStatement('SELECT * FROM album FOR UPDATE', 500)).toBe(
      'SELECT * FROM album FOR UPDATE'
    );
  });

  it('leaves alone a limit that is not a limit', () => {
    for (const rows of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, UNLIMITED]) {
      expect(limitStatement('SELECT 1', rows), String(rows)).toBe('SELECT 1');
    }
  });
});
