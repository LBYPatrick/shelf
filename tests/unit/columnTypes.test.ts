import { describe, expect, it } from 'vitest';
import { isNumericType } from '@shared/columnTypes';

describe('recognising a numeric column', () => {
  it('covers how the nine engines actually spell their number types', () => {
    for (const type of [
      'int',
      'int4',
      'int8',
      'integer',
      'INTEGER',
      'smallint',
      'bigint',
      'mediumint',
      'tinyint',
      'serial',
      'bigserial',
      'float',
      'float8',
      'double',
      'real',
      'decimal(10,2)',
      'numeric(2,1)',
      'number(10)',
      'money',
      'int unsigned',
      'bigint UNSIGNED',
    ]) {
      expect(isNumericType(type), type).toBe(true);
    }
  });

  it('leaves anything that is not a quantity aligned as text', () => {
    for (const type of [
      'text',
      'varchar(255)',
      'date',
      'timestamptz',
      'jsonb',
      'bytea',
      'boolean',
      'uuid',
      // A name that merely starts with a letter run — the family has to match
      // from the start, not appear anywhere in the string.
      'interval',
      'point',
      undefined,
    ]) {
      expect(isNumericType(type), String(type)).toBe(false);
    }
  });
});
