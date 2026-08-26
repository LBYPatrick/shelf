import { describe, expect, it } from 'vitest';
import { classifyScript, classifyStatement, isReadOnly } from '@shared/sqlSafety';

/*
 * The gate between the assistant and someone's database.
 *
 * Every case here is one a misclassification would wave through silently — no
 * exception, no error, just a table with fewer rows in it than it had. The
 * asymmetry is the point: calling a read a write costs a question, calling a
 * write a read costs data, so anything unrecognised has to land on the safe
 * side.
 */

describe('classifying one statement', () => {
  it('recognises the ordinary reads', () => {
    expect(classifyStatement('SELECT * FROM users')).toBe('read');
    expect(classifyStatement('  select 1  ')).toBe('read');
    expect(classifyStatement('SHOW TABLES')).toBe('read');
    expect(classifyStatement('PRAGMA table_info(users)')).toBe('read');
    expect(classifyStatement('VALUES (1), (2)')).toBe('read');
  });

  it('recognises the writes', () => {
    expect(classifyStatement('DELETE FROM users')).toBe('write');
    expect(classifyStatement('UPDATE users SET name = 1')).toBe('write');
    expect(classifyStatement('insert into users values (1)')).toBe('write');
    expect(classifyStatement('MERGE INTO a USING b ON x')).toBe('write');
    expect(classifyStatement('GRANT ALL ON users TO bob')).toBe('write');
  });

  it('recognises the statements that change the shape', () => {
    expect(classifyStatement('DROP TABLE users')).toBe('schema');
    expect(classifyStatement('TRUNCATE users')).toBe('schema');
    expect(classifyStatement('ALTER TABLE users ADD COLUMN x int')).toBe('schema');
  });

  it('treats anything it does not recognise as a write', () => {
    // A dialect's own verb is far likelier than a SELECT we failed to spot.
    expect(classifyStatement('UPSERT INTO users VALUES (1)')).not.toBe('read');
    expect(classifyStatement('FLUSHDB')).toBe('unknown');
    expect(classifyStatement('')).toBe('unknown');
    expect(isReadOnly('FLUSHDB')).toBe(false);
  });

  it('sees past a leading comment', () => {
    expect(classifyStatement('-- count them\nSELECT count(*) FROM users')).toBe('read');
    expect(classifyStatement('/* tidy up */ DELETE FROM users')).toBe('write');
    // A comment naming a harmless verb does not make the statement harmless.
    expect(classifyStatement('-- just a select\nDROP TABLE users')).toBe('schema');
  });

  it('sees past a leading parenthesis', () => {
    expect(classifyStatement('(SELECT 1) UNION (SELECT 2)')).toBe('read');
  });

  describe('the two traps', () => {
    it('reads a CTE by what it ends in, not what it starts with', () => {
      expect(classifyStatement('WITH x AS (SELECT 1) SELECT * FROM x')).toBe('read');
      // Postgres allows this, and the leading keyword says nothing about it.
      expect(classifyStatement('WITH doomed AS (SELECT id FROM users) DELETE FROM users')).toBe(
        'write'
      );
    });

    it('knows EXPLAIN ANALYZE runs the statement', () => {
      expect(classifyStatement('EXPLAIN SELECT * FROM users')).toBe('read');
      expect(classifyStatement('EXPLAIN DELETE FROM users')).toBe('read');
      // ...but this one actually performs the delete.
      expect(classifyStatement('EXPLAIN ANALYZE DELETE FROM users')).toBe('write');
      expect(classifyStatement('EXPLAIN (ANALYZE true) DELETE FROM users')).toBe('write');
    });
  });

  it('does not mistake a word inside a string for a verb', () => {
    expect(classifyStatement("WITH x AS (SELECT 'delete me' AS s) SELECT * FROM x")).toBe(
      'read'
    );
  });
});

describe('classifying a script', () => {
  it('takes the loudest statement, not the first', () => {
    expect(classifyScript(['SELECT 1', 'SELECT 2'])).toBe('read');
    // A write riding in behind a read is still a write.
    expect(classifyScript(['SELECT 1', 'DELETE FROM users', 'SELECT 2'])).toBe('write');
    expect(classifyScript(['DELETE FROM users', 'DROP TABLE users'])).toBe('schema');
  });

  it('calls an empty script a read', () => {
    expect(classifyScript([])).toBe('read');
  });
});
