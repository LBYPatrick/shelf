import { describe, expect, it } from 'vitest';
import type { EngineNouns } from '@drivers/types';
import { languageName, splitReply, systemPrompt } from '@shared/aiPrompt';
import { buildSchemaDocument, type SchemaDocument } from '@shared/schemaDoc';

/*
 * Both halves of talking to a model fail quietly.
 *
 * A prompt that forgets the dialect produces valid SQL that is wrong for this
 * server; a splitter that mishandles a fence draws a statement as a paragraph,
 * or a paragraph as a statement with a "run this" button on it. Neither
 * throws.
 */

const NOUNS: EngineNouns = {
  database: 'keyspace',
  entity: 'collection',
  row: 'document',
  column: 'field',
};

function document(over: Partial<SchemaDocument> = {}): SchemaDocument {
  return {
    ...buildSchemaDocument({
      engine: 'mongodb',
      language: 'javascript',
      nouns: NOUNS,
      scope: { kind: 'schema', name: 'shop' },
      entities: [
        {
          entity: { name: 'orders', kind: 'table' },
          columns: [
            { name: 'id', dataType: 'objectid', nullable: false, primaryKey: true, ordinal: 1 },
          ],
        },
      ],
    }),
    ...over,
  };
}

describe('the system prompt', () => {
  it('names the engine, the language and the scope', () => {
    const prompt = systemPrompt({ document: document(), canRun: true });
    expect(prompt).toContain('Engine: mongodb');
    expect(prompt).toContain('javascript');
    expect(prompt).toContain('shop');
  });

  it('uses the engine’s own words for its things', () => {
    const prompt = systemPrompt({ document: document(), canRun: true });
    // An interface that calls a collection a table reads as written for a
    // different product; so does a prompt.
    expect(prompt).toContain('collection');
    expect(prompt).toContain('keyspace');
  });

  it('puts the schema last, so the stable half can be cached', () => {
    const prompt = systemPrompt({ document: document(), canRun: true });
    expect(prompt.indexOf('Schema, as JSON:')).toBeGreaterThan(prompt.indexOf('Engine:'));
    expect(prompt.trimEnd().endsWith('}')).toBe(true);
  });

  it('explains what each intent does, rather than naming them', () => {
    // A model told only "set intent" sets it to whatever it ran last.
    const prompt = systemPrompt({ document: document(), canRun: true });
    expect(prompt).toMatch(/folded away/i);
    expect(prompt).toMatch(/rows are the reply/i);
    expect(prompt).toMatch(/`check`/);
    expect(prompt).toMatch(/`answer`/);
  });

  it('asks for a name on every query, and on a fence', () => {
    const prompt = systemPrompt({ document: document(), canRun: true });
    expect(prompt).toMatch(/purpose/);
    expect(prompt).toMatch(/title=/);
  });

  it('still asks for names when it cannot run anything', () => {
    // The fence title is how a block gets its name, and a provider with no
    // tools writes nothing but fences.
    expect(systemPrompt({ document: document(), canRun: false })).toMatch(/title=/);
  });

  it('states the read-only rule when it can run things', () => {
    const prompt = systemPrompt({ document: document(), canRun: true });
    expect(prompt).toMatch(/never run anything that modifies/i);
    expect(prompt).toMatch(/leave running it to the person/i);
  });

  it('says it cannot run anything when it cannot', () => {
    const prompt = systemPrompt({ document: document(), canRun: false });
    expect(prompt).toMatch(/cannot run anything/i);
    // ...and does not also promise a rule about running that cannot apply.
    expect(prompt).not.toMatch(/you may run read-only statements/i);
  });

  describe('the language a reply is written in', () => {
    it('names the interface language, and only as a fallback', () => {
      const prompt = systemPrompt({ document: document(), canRun: true, locale: 'zh-CN' });
      // The question decides; the interface settles what the question cannot.
      expect(prompt).toMatch(/language the question is written in/i);
      expect(prompt).toContain('Chinese');
    });

    it('says identifiers are never translated', () => {
      // Told to answer in Japanese, a model will translate `play_count` in the
      // prose around a query and leave the reader hunting for a column that
      // does not exist.
      const prompt = systemPrompt({ document: document(), canRun: true, locale: 'ja' });
      expect(prompt).toMatch(/never translated/i);
    });

    it('says nothing at all when there is no locale', () => {
      const prompt = systemPrompt({ document: document(), canRun: true });
      expect(prompt).not.toMatch(/language the question is written in/i);
    });

    it('applies whether or not it can run anything', () => {
      expect(systemPrompt({ document: document(), canRun: false, locale: 'ko' })).toContain(
        'Korean'
      );
    });

    it('keeps the schema last, so the cacheable half stays cacheable', () => {
      const prompt = systemPrompt({ document: document(), canRun: true, locale: 'vi' });
      expect(prompt.indexOf('Schema, as JSON:')).toBeGreaterThan(prompt.indexOf('Vietnamese'));
    });
  });

  describe('naming a language', () => {
    it('names every language the interface ships', () => {
      expect(languageName('en-US')).toContain('English');
      expect(languageName('ja')).toBe('Japanese');
      expect(languageName('zh-CN')).toContain('Chinese');
      expect(languageName('ko')).toBe('Korean');
      expect(languageName('vi')).toBe('Vietnamese');
    });

    it('hands back anything it cannot name, rather than failing', () => {
      // A model reads a tag perfectly well; a throw here would take the turn
      // down over a label.
      expect(languageName('')).toBe('');
      expect(languageName('not a tag at all')).toBe('not a tag at all');
    });
  });

  it('passes on what the document does not contain', () => {
    const prompt = systemPrompt({
      document: document({ omissions: ['12 of 400 tables are not included.'] }),
      canRun: true,
    });
    expect(prompt).toContain('What you were not shown:');
    expect(prompt).toContain('12 of 400 tables are not included.');
  });
});

describe('splitting a chat reply', () => {
  it('keeps prose and statements in the order they were written', () => {
    const parts = splitReply('First.\n\n```sql\nSELECT 1;\n```\n\nSecond.');
    expect(parts).toEqual([
      { kind: 'text', text: 'First.' },
      { kind: 'sql', text: 'SELECT 1;' },
      { kind: 'text', text: 'Second.' },
    ]);
  });

  it('reads an unlabelled fence as SQL only when it is SQL', () => {
    expect(splitReply('```\nSELECT 1\n```')[0]?.kind).toBe('sql');
    // A block of results in an unlabelled fence must not get a "run this" button.
    expect(splitReply('```\nid | name\n1  | a\n```')[0]?.kind).toBe('text');
  });

  it('leaves another language alone', () => {
    const parts = splitReply('```python\nprint(1)\n```');
    expect(parts[0]).toEqual({ kind: 'text', text: 'print(1)' });
  });

  it('returns a plain reply as one piece', () => {
    expect(splitReply('No idea, sorry.')).toEqual([{ kind: 'text', text: 'No idea, sorry.' }]);
  });

  it('has nothing to say about nothing', () => {
    expect(splitReply('   ')).toEqual([]);
  });

  describe('the name on a fence', () => {
    it('takes a title off the info string', () => {
      // A block written out rather than run has no `purpose` to take a name
      // from, so the name rides on the fence.
      expect(splitReply('```sql title=Albums per artist\nSELECT 1\n```')).toEqual([
        { kind: 'sql', text: 'SELECT 1', title: 'Albums per artist' },
      ]);
    });

    it('accepts the spellings a model actually uses', () => {
      const forms = [
        '```sql title="Rows per table"\nSELECT 1\n```',
        '```sql title: Rows per table\nSELECT 1\n```',
        '```sql  title = Rows per table \nSELECT 1\n```',
      ];
      for (const reply of forms) {
        expect(splitReply(reply)[0]).toMatchObject({ title: 'Rows per table' });
      }
    });

    it('is still SQL when the fence carries no title', () => {
      expect(splitReply('```sql\nSELECT 1\n```')).toEqual([{ kind: 'sql', text: 'SELECT 1' }]);
    });

    it('does not take a title from a fence that is not SQL', () => {
      expect(splitReply('```python title=Nope\nprint(1)\n```')[0]).toEqual({
        kind: 'text',
        text: 'print(1)',
      });
    });
  });
});
