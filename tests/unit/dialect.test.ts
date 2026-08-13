import { describe, expect, it } from 'vitest';
import {
  ANSI_DIALECT,
  buildOrderBy,
  buildSelectList,
  buildWhere,
  qualify,
  quoteIdentifier,
  type Dialect,
} from '@drivers/sql/dialect';
import { buildChangePreview, buildChangeStatements, untag } from '@drivers/sql/changes';
import { singleSourceTable, splitStatements } from '@drivers/sql/statements';
import type { Filters } from '@drivers/types';

const MYSQL: Dialect = {
  quote: '`',
  placeholder: () => '?',
  limitClause: (limit, offset) => `LIMIT ${limit} OFFSET ${offset}`,
};

const POSTGRES: Dialect = {
  quote: '"',
  placeholder: (index) => `$${index}`,
  limitClause: (limit, offset) => `LIMIT ${limit} OFFSET ${offset}`,
};

describe('identifier quoting', () => {
  it('wraps names in the dialect quote', () => {
    expect(quoteIdentifier('users', ANSI_DIALECT)).toBe('"users"');
    expect(quoteIdentifier('users', MYSQL)).toBe('`users`');
  });

  it('doubles an embedded quote so the identifier cannot be escaped', () => {
    expect(quoteIdentifier('it"s', ANSI_DIALECT)).toBe('"it""s"');
    expect(quoteIdentifier('we`ird', MYSQL)).toBe('`we``ird`');
  });

  it('neutralises an injection attempt in a table name', () => {
    const hostile = 'users"; DROP TABLE users; --';
    const quoted = quoteIdentifier(hostile, ANSI_DIALECT);
    // Every quote in the payload is doubled, so nothing closes the identifier.
    expect(quoted.slice(1, -1).split('""').join('')).not.toContain('"');
  });

  it('qualifies with the schema only when there is one', () => {
    expect(qualify({ name: 'users', schema: 'public' }, ANSI_DIALECT)).toBe('"public"."users"');
    expect(qualify({ name: 'users' }, ANSI_DIALECT)).toBe('"users"');
  });
});

describe('where clauses', () => {
  it('is empty when there is nothing to filter', () => {
    expect(buildWhere(undefined, ANSI_DIALECT)).toEqual({ sql: '', params: [] });
    expect(buildWhere({ kind: 'builder', filters: [] }, ANSI_DIALECT).sql).toBe('');
  });

  it('binds values rather than interpolating them', () => {
    const filters: Filters = {
      kind: 'builder',
      filters: [{ column: 'name', operator: 'like', value: "'; DROP TABLE users; --" }],
    };
    const { sql, params } = buildWhere(filters, ANSI_DIALECT);
    expect(sql).toBe(' WHERE "name" LIKE ?');
    expect(params).toEqual(["'; DROP TABLE users; --"]);
  });

  it('numbers placeholders for dialects that require it', () => {
    const filters: Filters = {
      kind: 'builder',
      filters: [
        { column: 'a', operator: '=', value: 1 },
        { column: 'b', operator: '=', value: 2, join: 'and' },
      ],
    };
    expect(buildWhere(filters, POSTGRES).sql).toBe(' WHERE "a" = $1 AND "b" = $2');
  });

  it('honours the join between filters', () => {
    const filters: Filters = {
      kind: 'builder',
      filters: [
        { column: 'a', operator: '=', value: 1 },
        { column: 'b', operator: '=', value: 2, join: 'or' },
      ],
    };
    expect(buildWhere(filters, ANSI_DIALECT).sql).toBe(' WHERE "a" = ? OR "b" = ?');
  });

  it('omits a value for null checks', () => {
    const filters: Filters = {
      kind: 'builder',
      filters: [{ column: 'deleted_at', operator: 'is null' }],
    };
    const { sql, params } = buildWhere(filters, ANSI_DIALECT);
    expect(sql).toBe(' WHERE "deleted_at" IS NULL');
    expect(params).toEqual([]);
  });

  it('expands an IN list into one placeholder per value', () => {
    const filters: Filters = {
      kind: 'builder',
      filters: [{ column: 'id', operator: 'in', value: [1, 2, 3] }],
    };
    const { sql, params } = buildWhere(filters, ANSI_DIALECT);
    expect(sql).toBe(' WHERE "id" IN (?, ?, ?)');
    expect(params).toEqual([1, 2, 3]);
  });

  it('turns an empty IN list into a constant instead of invalid SQL', () => {
    expect(
      buildWhere(
        { kind: 'builder', filters: [{ column: 'id', operator: 'in', value: [] }] },
        ANSI_DIALECT
      ).sql
    ).toBe(' WHERE 1 = 0');
    expect(
      buildWhere(
        { kind: 'builder', filters: [{ column: 'id', operator: 'not in', value: [] }] },
        ANSI_DIALECT
      ).sql
    ).toBe(' WHERE 1 = 1');
  });

  it('passes raw filters through untouched', () => {
    expect(buildWhere({ kind: 'raw', expression: "name like 'A%'" }, ANSI_DIALECT).sql).toBe(
      " WHERE name like 'A%'"
    );
  });

  it('ignores a blank raw filter', () => {
    expect(buildWhere({ kind: 'raw', expression: '   ' }, ANSI_DIALECT).sql).toBe('');
  });
});

describe('order and projection', () => {
  it('renders nothing when unsorted', () => {
    expect(buildOrderBy(undefined, ANSI_DIALECT)).toBe('');
    expect(buildOrderBy([], ANSI_DIALECT)).toBe('');
  });

  it('quotes sorted columns and normalises direction', () => {
    expect(buildOrderBy([{ column: 'created at', direction: 'desc' }], ANSI_DIALECT)).toBe(
      ' ORDER BY "created at" DESC'
    );
  });

  it('selects everything when no projection is given', () => {
    expect(buildSelectList(undefined, ANSI_DIALECT)).toBe('*');
    expect(buildSelectList([], ANSI_DIALECT)).toBe('*');
  });

  it('quotes each projected column', () => {
    expect(buildSelectList(['id', 'full name'], ANSI_DIALECT)).toBe('"id", "full name"');
  });
});

describe('change statements', () => {
  const entity = { name: 'users', schema: 'public' };

  it('binds inserted values', () => {
    const [statement] = buildChangeStatements(
      { inserts: [{ entity, values: { name: "O'Brien", age: 40 } }], updates: [], deletes: [] },
      POSTGRES
    );
    expect(statement!.sql).toBe('INSERT INTO "public"."users" ("name", "age") VALUES ($1, $2)');
    expect(statement!.params).toEqual(["O'Brien", 40]);
  });

  it('refuses to update a row it cannot address', () => {
    expect(() =>
      buildChangeStatements(
        {
          inserts: [],
          updates: [{ entity, primaryKeys: [], column: 'name', value: 'x' }],
          deletes: [],
        },
        POSTGRES
      )
    ).toThrow(/no primary key/);
  });

  it('refuses to delete a row it cannot address', () => {
    expect(() =>
      buildChangeStatements(
        { inserts: [], updates: [], deletes: [{ entity, primaryKeys: [] }] },
        POSTGRES
      )
    ).toThrow(/no primary key/);
  });

  it('addresses a row by its whole composite key', () => {
    const [statement] = buildChangeStatements(
      {
        inserts: [],
        updates: [
          {
            entity,
            primaryKeys: [
              { column: 'tenant', value: 't1' },
              { column: 'id', value: 7 },
            ],
            column: 'name',
            value: 'new',
          },
        ],
        deletes: [],
      },
      POSTGRES
    );
    expect(statement!.sql).toBe(
      'UPDATE "public"."users" SET "name" = $1 WHERE "tenant" = $2 AND "id" = $3'
    );
    expect(statement!.params).toEqual(['new', 't1', 7]);
  });

  it('previews exactly what it would run, with values escaped', () => {
    const preview = buildChangePreview(
      {
        inserts: [],
        updates: [
          {
            entity,
            primaryKeys: [{ column: 'id', value: 1 }],
            column: 'name',
            value: "O'Brien",
          },
        ],
        deletes: [],
      },
      POSTGRES
    );
    expect(preview).toBe(`UPDATE "public"."users" SET "name" = 'O''Brien' WHERE "id" = 1;`);
  });

  it('substitutes double-digit placeholders without corrupting them', () => {
    const values = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [`c${index}`, index])
    );
    const preview = buildChangePreview(
      { inserts: [{ entity, values }], updates: [], deletes: [] },
      POSTGRES
    );
    // If $1 were substituted before $11, the tail would read "0 1" not "10, 11".
    expect(preview).toContain('VALUES (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11)');
  });

  it('unwraps tagged values before binding them', () => {
    expect(untag({ $: 'bigint', data: '9007199254740993' })).toBe('9007199254740993');
    expect(untag({ $: 'binary', data: Buffer.from('hi').toString('base64') })).toEqual(
      Buffer.from('hi')
    );
    expect(untag(null)).toBeNull();
    expect(untag(42)).toBe(42);
  });
});

describe('finding the source table', () => {
  it('finds a plain table', () => {
    expect(singleSourceTable('SELECT * FROM users')).toEqual({ name: 'users' });
  });

  it('finds a schema-qualified table', () => {
    expect(singleSourceTable('select id from public.users where id = 1')).toEqual({
      name: 'users',
      schema: 'public',
    });
  });

  it('handles quoted identifiers', () => {
    expect(singleSourceTable('SELECT * FROM "users"')).toEqual({ name: 'users' });
    expect(singleSourceTable('SELECT * FROM `users`')).toEqual({ name: 'users' });
  });

  it('refuses a join, because a value could belong to either table', () => {
    expect(
      singleSourceTable('SELECT * FROM users u JOIN orders o ON o.user_id = u.id')
    ).toBeUndefined();
  });

  it('refuses an old-style comma join', () => {
    expect(
      singleSourceTable('SELECT * FROM users, orders WHERE users.id = orders.user_id')
    ).toBeUndefined();
  });

  it('refuses set operations', () => {
    expect(singleSourceTable('SELECT id FROM a UNION SELECT id FROM b')).toBeUndefined();
  });

  it('is not fooled by the word join inside a comment', () => {
    expect(singleSourceTable('SELECT * FROM users -- join orders later')).toEqual({
      name: 'users',
    });
    expect(singleSourceTable('SELECT * FROM users /* join orders */ WHERE id = 1')).toEqual({
      name: 'users',
    });
  });

  it('is unaffected by a comma in the select list', () => {
    expect(singleSourceTable('SELECT id, name, email FROM users ORDER BY name')).toEqual({
      name: 'users',
    });
  });

  it('returns nothing when there is no FROM at all', () => {
    expect(singleSourceTable('SELECT 1')).toBeUndefined();
  });
});

describe('splitting scripts', () => {
  it('splits on statement boundaries', () => {
    expect(splitStatements('SELECT 1; SELECT 2;')).toHaveLength(2);
  });

  it('ignores trailing whitespace and empty statements', () => {
    expect(splitStatements('SELECT 1;;   ')).toEqual(['SELECT 1;']);
  });

  it('returns nothing for empty input', () => {
    expect(splitStatements('   ')).toEqual([]);
  });

  it('keeps a semicolon inside a string literal in one statement', () => {
    expect(splitStatements("SELECT ';' AS semi")).toHaveLength(1);
  });
});
