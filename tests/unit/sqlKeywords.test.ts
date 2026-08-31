import { describe, expect, it } from 'vitest';
import { sqlWords } from '@shared/sqlKeywords';
import type { EngineId } from '@drivers/types';

const SQL_ENGINES: EngineId[] = ['postgres', 'mysql', 'tidb', 'sqlite', 'duckdb', 'mock'];

function texts(engine: EngineId | undefined): string[] {
  return sqlWords(engine).map((word) => word.text);
}

describe('the words an engine understands', () => {
  it('offers the shape of a statement to every SQL engine', () => {
    // The half the completer was missing: it knew every table name and not one
    // of the words that go between them.
    for (const engine of SQL_ENGINES) {
      const words = texts(engine);
      for (const expected of ['SELECT', 'FROM', 'WHERE', 'LEFT JOIN', 'GROUP BY', 'ORDER BY']) {
        expect(words, engine).toContain(expected);
      }
    }
  });

  it('offers nothing to an engine that does not speak SQL', () => {
    // A `SELECT` in a Redis or MongoDB editor is a word that cannot be run.
    for (const engine of ['redis', 'mongodb', 'dynamodb'] as EngineId[]) {
      expect(sqlWords(engine), engine).toEqual([]);
    }
    expect(sqlWords(undefined)).toEqual([]);
  });

  it('keeps each dialect out of the others', () => {
    expect(texts('postgres')).toContain('jsonb');
    expect(texts('postgres')).not.toContain('AUTO_INCREMENT');

    expect(texts('mysql')).toContain('AUTO_INCREMENT');
    expect(texts('mysql')).not.toContain('jsonb');

    expect(texts('sqlite')).toContain('AUTOINCREMENT');
    expect(texts('duckdb')).toContain('QUALIFY');
  });

  it('gives TiDB MySQL’s dialect, and mock SQLite’s', () => {
    // Both report themselves as their own engine while speaking someone else's.
    expect(texts('tidb')).toEqual(texts('mysql'));
    expect(texts('mock')).toEqual(texts('sqlite'));
  });

  it('gives Scylla CQL rather than SQL with corrections', () => {
    const words = texts('scylla');
    expect(words).toContain('ALLOW FILTERING');
    expect(words).toContain('timeuuid');
    // CQL has neither, so offering them would teach the reader something untrue.
    expect(words).not.toContain('LEFT JOIN');
    expect(words).not.toContain('OFFSET');
  });

  it('offers no word twice', () => {
    // The lists overlap on purpose — DuckDB's REPLACE is a clause where the core
    // list has it as a function — and one word with two icons is a choice the
    // reader cannot make.
    for (const engine of [...SQL_ENGINES, 'scylla' as EngineId]) {
      const words = texts(engine);
      expect(new Set(words).size, engine).toBe(words.length);
    }
  });

  it('spells keywords the way the Format button would', () => {
    // `keywordCase: 'upper'`, so a completer inserting `select` is a second
    // opinion rather than a help. Types keep the engine's own spelling.
    for (const engine of SQL_ENGINES) {
      for (const word of sqlWords(engine)) {
        if (word.kind === 'type') continue;
        expect(word.text, `${engine} ${word.text}`).toBe(word.text.toUpperCase());
      }
    }
  });
});
