import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, type Block, type Inline } from '@shared/markdown';

/*
 * The reply, as the chat has to draw it.
 *
 * Two kinds of failure live here and neither throws. One is cosmetic and
 * constant — `**bold**` on screen with its asterisks, a list as four lines
 * starting with a hyphen. The other is not cosmetic at all: this text is
 * written by a model that may be repeating a row out of the reader's own
 * database, so anything that turns it into markup turns a table cell into a
 * script tag. The parser's whole job is to produce a *tree*, never a string of
 * HTML, and the link cases below are where that promise is kept.
 */

const text = (value: string): Inline => ({ kind: 'text', text: value });

/** The plain text of a tree, for asserting shape without spelling out nodes. */
function flatten(nodes: readonly Inline[]): string {
  return nodes
    .map((node) => {
      if (node.kind === 'text' || node.kind === 'code') return node.text;
      if (node.kind === 'link') return node.text;
      return flatten(node.children);
    })
    .join('');
}

describe('inline', () => {
  it('leaves ordinary prose alone', () => {
    expect(parseInline('just a sentence')).toEqual([text('just a sentence')]);
  });

  it('reads bold and italic in both spellings', () => {
    expect(parseInline('**loud**')).toEqual([{ kind: 'strong', children: [text('loud')] }]);
    expect(parseInline('__loud__')).toEqual([{ kind: 'strong', children: [text('loud')] }]);
    expect(parseInline('*soft*')).toEqual([{ kind: 'em', children: [text('soft')] }]);
    expect(parseInline('_soft_')).toEqual([{ kind: 'em', children: [text('soft')] }]);
  });

  it('does not italicise a snake_case identifier', () => {
    // `daily_metrics` and `artist_id` are the commonest words in these replies.
    expect(parseInline('daily_metrics_table')).toEqual([text('daily_metrics_table')]);
  });

  it('nests emphasis', () => {
    expect(flatten(parseInline('**bold with *italic* inside**'))).toBe(
      'bold with italic inside'
    );
  });

  it('keeps a code span literal', () => {
    // The commonest thing a model puts in backticks here is a column name, and
    // the second commonest is something with an asterisk in it.
    expect(parseInline('`select **x**`')).toEqual([{ kind: 'code', text: 'select **x**' }]);
  });

  it('handles a code span written with doubled backticks', () => {
    expect(parseInline('`` a ` b ``')).toEqual([{ kind: 'code', text: 'a ` b' }]);
  });

  it('reads a link, and an autolink', () => {
    expect(parseInline('[docs](https://example.com/a)')).toEqual([
      { kind: 'link', text: 'docs', href: 'https://example.com/a' },
    ]);
    expect(parseInline('<https://example.com>')).toEqual([
      { kind: 'link', text: 'https://example.com', href: 'https://example.com' },
    ]);
  });

  describe('links it will not follow', () => {
    it('drops a javascript: href but keeps the words', () => {
      expect(parseInline('[click](javascript:alert(1))')).toEqual([
        { kind: 'link', text: 'click' },
      ]);
    });

    it('drops a data: href, which is a document and therefore a script', () => {
      const parsed = parseInline('[x](data:text/html,<script>alert(1)</script>)');
      expect(parsed[0]).toMatchObject({ kind: 'link' });
      expect((parsed[0] as { href?: string }).href).toBeUndefined();
    });

    it('is not fooled by leading space or odd case', () => {
      expect((parseInline('[x](  JaVaScRiPt:alert(1))')[0] as { href?: string }).href).toBe(
        undefined
      );
    });
  });

  it('never turns markup into markup', () => {
    // The whole safety argument in one assertion: angle brackets stay text.
    expect(parseInline('<script>alert(1)</script>')).toEqual([
      text('<script>alert(1)</script>'),
    ]);
  });
});

describe('blocks', () => {
  it('splits paragraphs on blank lines', () => {
    const blocks = parseMarkdown('one\n\ntwo');
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'paragraph']);
  });

  it('joins wrapped lines into one paragraph', () => {
    const blocks = parseMarkdown('a sentence\ncontinued here');
    expect(blocks).toHaveLength(1);
    expect(flatten((blocks[0] as Extract<Block, { kind: 'paragraph' }>).children)).toBe(
      'a sentence\ncontinued here'
    );
  });

  it('reads headings, and never above level three', () => {
    const blocks = parseMarkdown('# One\n\n## Two\n\n### Three');
    expect(blocks.map((b) => (b as { level?: number }).level)).toEqual([1, 2, 3]);
  });

  it('reads a bulleted list', () => {
    const blocks = parseMarkdown('- alpha\n- beta\n- gamma');
    expect(blocks).toHaveLength(1);

    const list = blocks[0] as Extract<Block, { kind: 'list' }>;
    expect(list.ordered).toBe(false);
    expect(list.items).toHaveLength(3);
    expect(
      list.items.map((item) =>
        flatten((item[0] as Extract<Block, { kind: 'paragraph' }>).children)
      )
    ).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('reads a numbered list, in either punctuation', () => {
    expect((parseMarkdown('1. a\n2. b')[0] as { ordered?: boolean }).ordered).toBe(true);
    expect((parseMarkdown('1) a\n2) b')[0] as { ordered?: boolean }).ordered).toBe(true);
  });

  it('keeps the markup inside a list item', () => {
    // The exact shape the screenshot showed going wrong.
    const list = parseMarkdown('- **What I do:** write SQL')[0] as Extract<
      Block,
      { kind: 'list' }
    >;
    const paragraph = list.items[0]![0] as Extract<Block, { kind: 'paragraph' }>;
    expect(paragraph.children[0]).toEqual({
      kind: 'strong',
      children: [text('What I do:')],
    });
  });

  it('starts a new list when the kind changes', () => {
    const blocks = parseMarkdown('- a\n- b\n\n1. c');
    expect(blocks.map((block) => block.kind)).toEqual(['list', 'list']);
  });

  it('reads a blockquote', () => {
    const quote = parseMarkdown('> careful\n> with this')[0] as Extract<
      Block,
      { kind: 'quote' }
    >;
    expect(quote.kind).toBe('quote');
    expect(quote.children[0]?.kind).toBe('paragraph');
  });

  it('reads a rule, in any of its spellings', () => {
    expect(parseMarkdown('---')[0]?.kind).toBe('rule');
    expect(parseMarkdown('***')[0]?.kind).toBe('rule');
    expect(parseMarkdown('___')[0]?.kind).toBe('rule');
  });

  it('reads a table only when it has a separator row', () => {
    const table = parseMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |')[0] as Extract<
      Block,
      { kind: 'table' }
    >;
    expect(table.kind).toBe('table');
    expect(table.head.map(flatten)).toEqual(['a', 'b']);
    expect(table.rows[0]?.map(flatten)).toEqual(['1', '2']);
  });

  it('leaves a sentence with a pipe in it as a sentence', () => {
    // Far more common than a table, and guessing wrong turns prose into a grid.
    expect(parseMarkdown('use a | b for alternation')[0]?.kind).toBe('paragraph');
  });

  it('has nothing to say about nothing', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('   \n\n  ')).toEqual([]);
  });

  it('parses a whole reply of the kind that shipped wrong', () => {
    const reply = [
      "I'm a database assistant. What that means here:",
      '',
      '- **What I do:** write SQL for your connection.',
      '- **Dialect:** I target the `mock` engine specifically.',
      "- **What I can't do:** execute anything.",
      '',
      'Ask me for a query and I will write it.',
    ].join('\n');

    const blocks = parseMarkdown(reply);
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'list', 'paragraph']);
    expect((blocks[1] as Extract<Block, { kind: 'list' }>).items).toHaveLength(3);
    // And no asterisk survives into the drawn text.
    const drawn = (blocks[1] as Extract<Block, { kind: 'list' }>).items
      .map((item) => flatten((item[0] as Extract<Block, { kind: 'paragraph' }>).children))
      .join(' ');
    expect(drawn).not.toContain('**');
  });
});
