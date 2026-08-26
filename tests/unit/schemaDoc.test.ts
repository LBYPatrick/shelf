import { describe, expect, it } from 'vitest';
import type { Column, EngineNouns, Entity, Index, Relation } from '@drivers/types';
import {
  buildSchemaDocument,
  estimateTokens,
  narrowSchemaDocument,
  qualifiedName,
  schemaDocumentText,
  scopeLabel,
  toTableDoc,
  type EntityFacts,
  type SchemaDocument,
} from '@shared/schemaDoc';

/*
 * What the assistant is told about a database.
 *
 * Every failure here is silent by construction: a relation dropped on the way
 * in is a join the model never proposes, and a document that quietly holds half
 * a schema is a confident query against a table that was left out.
 */

const NOUNS: EngineNouns = {
  database: 'database',
  entity: 'table',
  row: 'row',
  column: 'column',
};

const column = (name: string, over: Partial<Column> = {}): Column => ({
  name,
  dataType: 'text',
  nullable: true,
  primaryKey: false,
  ordinal: 1,
  ...over,
});

const table = (name: string, over: Partial<EntityFacts> = {}): EntityFacts => ({
  entity: { name, kind: 'table' } as Entity,
  columns: [column('id', { dataType: 'integer', primaryKey: true, nullable: false })],
  ...over,
});

function documentOf(entities: readonly EntityFacts[]): SchemaDocument {
  return buildSchemaDocument({
    engine: 'postgres',
    language: 'sql',
    nouns: NOUNS,
    scope: { kind: 'connection' },
    entities,
  });
}

describe('one table as a document', () => {
  it('keeps the engine’s own type names, verbatim', () => {
    const doc = toTableDoc(
      table('t', {
        columns: [column('a', { dataType: 'character varying(64)' })],
      })
    );
    // A normalised "string" here is how a model ends up writing ANSI SQL at a
    // server that wanted something else.
    expect(doc.columns[0]?.type).toBe('character varying(64)');
  });

  it('orders columns the way the table does', () => {
    const doc = toTableDoc(
      table('t', {
        columns: [
          column('c', { ordinal: 3 }),
          column('a', { ordinal: 1 }),
          column('b', { ordinal: 2 }),
        ],
      })
    );
    expect(doc.columns.map((c) => c.name)).toEqual(['a', 'b', 'c']);
  });

  it('states the primary key once, not twice', () => {
    const indexes: Index[] = [
      { name: 't_pkey', columns: ['id'], unique: true, primary: true },
      { name: 't_name', columns: ['name'], unique: false, primary: false },
    ];
    const doc = toTableDoc(table('t', { indexes }));

    expect(doc.primaryKey).toEqual(['id']);
    // The primary-key index restates what the columns already carry.
    expect(doc.indexes?.map((index) => index.name)).toEqual(['t_name']);
  });

  it('splits relations into the two questions actually asked', () => {
    const relations: Relation[] = [
      {
        name: 'fk_out',
        direction: 'outgoing',
        columns: ['artist_id'],
        referencedTable: { name: 'artist', schema: 'music' },
        referencedColumns: ['id'],
      },
      {
        name: 'fk_in',
        direction: 'incoming',
        columns: ['id'],
        referencedTable: { name: 'track', schema: 'music' },
        referencedColumns: ['album_id'],
      },
    ];

    const doc = toTableDoc(table('album', { relations }));

    expect(doc.references).toEqual([
      {
        columns: ['artist_id'],
        references: { table: 'artist', schema: 'music', columns: ['id'] },
      },
    ]);
    // Stated from the other table's point of view, which is how the driver
    // reports it and how a join reads from this end.
    expect(doc.referencedBy).toEqual([
      { from: { table: 'track', schema: 'music' }, columns: ['album_id'], toColumns: ['id'] },
    ]);
  });

  it('omits what the engine had nothing to say about', () => {
    const doc = toTableDoc(table('t'));
    expect(doc.indexes).toBeUndefined();
    expect(doc.references).toBeUndefined();
    expect(doc.description).toBeUndefined();
  });
});

describe('the document as a whole', () => {
  it('survives the boundary it has to cross', () => {
    const doc = documentOf([table('a'), table('b')]);
    // It travels a MessagePort and then a JSON prompt; both have to be lossless.
    expect(() => structuredClone(doc)).not.toThrow();
    expect(JSON.parse(schemaDocumentText(doc))).toEqual(doc);
  });

  it('names the scope the way a sentence would', () => {
    expect(scopeLabel({ kind: 'connection' })).toBe('the whole connection');
    expect(scopeLabel({ kind: 'schema', name: 'music' })).toBe('music');
    expect(scopeLabel({ kind: 'entity', entity: { name: 'album', schema: 'music' } })).toBe(
      'music.album'
    );
    expect(qualifiedName({ name: 'album' })).toBe('album');
  });
});

describe('narrowing to a budget', () => {
  const wide = (name: string) =>
    table(name, {
      columns: Array.from({ length: 12 }, (_unused, index) =>
        column(`column_with_a_long_name_${index}`, { ordinal: index + 1 })
      ),
    });

  it('leaves a document that already fits completely alone', () => {
    const doc = documentOf([table('a')]);
    expect(narrowSchemaDocument(doc, { budget: 100_000 })).toBe(doc);
  });

  it('says what it left out, in the document itself', () => {
    const doc = documentOf(Array.from({ length: 40 }, (_u, i) => wide(`t${i}`)));
    const narrowed = narrowSchemaDocument(doc, { budget: 500 });

    expect(narrowed.tables.length).toBeLessThan(doc.tables.length);
    // A caveat kept out of the payload is a caveat the model never gets.
    expect(narrowed.omissions?.join(' ')).toMatch(/of 40 tables are not included/);
    expect(estimateTokens(schemaDocumentText(narrowed))).toBeLessThan(
      estimateTokens(schemaDocumentText(doc))
    );
  });

  it('keeps the table that was asked about, whatever it costs', () => {
    const doc = documentOf([
      ...Array.from({ length: 30 }, (_u, i) => wide(`filler${i}`)),
      wide('wanted'),
    ]);

    const narrowed = narrowSchemaDocument(doc, { budget: 400, keep: ['wanted'] });
    expect(narrowed.tables.map((t) => t.name)).toContain('wanted');
  });

  it('keeps the tables that one joins to, ahead of the rest', () => {
    const target = table('orders', {
      relations: [
        {
          name: 'fk',
          direction: 'outgoing',
          columns: ['customer_id'],
          referencedTable: { name: 'customers' },
          referencedColumns: ['id'],
        },
      ],
    });

    const doc = documentOf([
      ...Array.from({ length: 20 }, (_u, i) => wide(`filler${i}`)),
      target,
      table('customers'),
    ]);

    const narrowed = narrowSchemaDocument(doc, { budget: 320, keep: ['orders'] });
    const names = narrowed.tables.map((t) => t.name);

    expect(names).toContain('orders');
    // A query about orders is nearly always a query about orders and customers.
    expect(names).toContain('customers');
  });

  it('never references a table it does not contain', () => {
    const doc = documentOf([
      table('orders', {
        relations: [
          {
            name: 'fk',
            direction: 'outgoing',
            columns: ['x_id'],
            referencedTable: { name: 'dropped' },
            referencedColumns: ['id'],
          },
        ],
      }),
      ...Array.from({ length: 20 }, (_u, i) => wide(`filler${i}`)),
      wide('dropped'),
    ]);

    const narrowed = narrowSchemaDocument(doc, { budget: 260, keep: ['orders'] });
    const present = new Set(narrowed.tables.map((t) => t.name));

    for (const entry of narrowed.tables) {
      for (const relation of entry.references ?? []) {
        expect(present.has(relation.references.table)).toBe(true);
      }
      for (const relation of entry.referencedBy ?? []) {
        expect(present.has(relation.from.table)).toBe(true);
      }
    }
  });

  it('keeps the order the tables arrived in', () => {
    const doc = documentOf([wide('a'), wide('b'), wide('c'), wide('d'), wide('e')]);
    const narrowed = narrowSchemaDocument(doc, { budget: 400, keep: ['e'] });
    const names = narrowed.tables.map((t) => t.name);

    // Relevance decides what survives; it does not get to re-sort the list.
    expect([...names].sort()).toEqual(names);
  });

  it('keeps at least one table even under an impossible budget', () => {
    const doc = documentOf([wide('a'), wide('b')]);
    expect(narrowSchemaDocument(doc, { budget: 1 }).tables).toHaveLength(1);
  });
});
