import { describe, expect, it } from 'vitest';
import { buildDdl, describe as describeChange, isDestructive, isSupported } from '@shared/ddl';

const table = { name: 'album', schema: 'public' };

describe('generated DDL', () => {
  it('quotes identifiers in the engine’s own style', () => {
    expect(
      buildDdl(
        { kind: 'add-column', entity: table, name: 'note', dataType: 'text', nullable: true },
        'postgres'
      )
    ).toBe('ALTER TABLE "public"."album" ADD COLUMN "note" text;');

    expect(
      buildDdl(
        {
          kind: 'add-column',
          entity: { name: 'album' },
          name: 'note',
          dataType: 'text',
          nullable: true,
        },
        'mysql'
      )
    ).toBe('ALTER TABLE `album` ADD COLUMN `note` text;');
  });

  it('neutralises a quote inside an identifier', () => {
    const sql = buildDdl(
      {
        kind: 'add-column',
        entity: { name: 'a"b' },
        name: 'c',
        dataType: 'text',
        nullable: true,
      },
      'postgres'
    );
    expect(sql).toContain('"a""b"');
  });

  it('adds NOT NULL and DEFAULT only when asked', () => {
    expect(
      buildDdl(
        {
          kind: 'add-column',
          entity: { name: 't' },
          name: 'c',
          dataType: 'int',
          nullable: false,
          defaultValue: '0',
        },
        'postgres'
      )
    ).toBe('ALTER TABLE "t" ADD COLUMN "c" int NOT NULL DEFAULT 0;');
  });

  it('drops an index the way each engine expects', () => {
    expect(buildDdl({ kind: 'drop-index', entity: { name: 't' }, name: 'i' }, 'postgres')).toBe(
      'DROP INDEX "i";'
    );
    expect(buildDdl({ kind: 'drop-index', entity: { name: 't' }, name: 'i' }, 'mysql')).toBe(
      'ALTER TABLE `t` DROP INDEX `i`;'
    );
  });

  it('uses DELETE where the engine has no TRUNCATE', () => {
    expect(buildDdl({ kind: 'truncate-entity', entity: { name: 't' } }, 'sqlite')).toBe(
      'DELETE FROM "t";'
    );
    expect(buildDdl({ kind: 'truncate-entity', entity: { name: 't' } }, 'postgres')).toBe(
      'TRUNCATE TABLE "t";'
    );
  });

  it('builds a unique index only when asked', () => {
    expect(
      buildDdl(
        {
          kind: 'add-index',
          entity: { name: 't' },
          name: 'i',
          columns: ['a', 'b'],
          unique: true,
        },
        'postgres'
      )
    ).toBe('CREATE UNIQUE INDEX "i" ON "t" ("a", "b");');
  });
});

describe('guarding the user', () => {
  it('refuses what SQLite genuinely cannot do', () => {
    expect(
      isSupported({ kind: 'drop-column', entity: { name: 't' }, name: 'c' }, 'sqlite')
    ).toBe(false);
    expect(
      isSupported({ kind: 'drop-column', entity: { name: 't' }, name: 'c' }, 'postgres')
    ).toBe(true);
  });

  it('marks the changes that destroy data', () => {
    expect(isDestructive({ kind: 'drop-entity', entity: { name: 't' } })).toBe(true);
    expect(isDestructive({ kind: 'truncate-entity', entity: { name: 't' } })).toBe(true);
    expect(
      isDestructive({
        kind: 'add-index',
        entity: { name: 't' },
        name: 'i',
        columns: ['a'],
        unique: false,
      })
    ).toBe(false);
  });

  it('says plainly what will happen', () => {
    expect(describeChange({ kind: 'drop-entity', entity: { name: 'album' } })).toContain(
      'cannot be undone'
    );
  });
});
