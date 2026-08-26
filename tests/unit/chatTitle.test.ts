import { describe, expect, it } from 'vitest';
import { chatTitle } from '@shared/chatTitle';

/*
 * A title is written once, when the conversation is created, and is then the
 * name of that conversation for as long as it is kept. There is no second pass
 * to fix a bad one, which is why this is worth testing rather than eyeballing.
 */

describe('naming a conversation from its first question', () => {
  it('uses the question, capitalised', () => {
    expect(chatTitle('how many albums are there')).toBe('How many albums are there');
  });

  it('drops the trailing punctuation a label does not need', () => {
    expect(chatTitle('what is in this database?')).toBe('What is in this database');
    expect(chatTitle('list the tables.')).toBe('List the tables');
  });

  it('collapses whitespace and newlines', () => {
    expect(chatTitle('  count   the\trows  ')).toBe('Count the rows');
  });

  it('takes the first sentence, not the whole essay', () => {
    expect(
      chatTitle('Find the busiest day. I also want the revenue for it, and the previous week.')
    ).toBe('Find the busiest day');
  });

  it('takes the first line when the rest is pasted context', () => {
    expect(chatTitle('why is this slow\n\nselect * from album join track on ...')).toBe(
      'Why is this slow'
    );
  });

  describe('the preamble', () => {
    it('cuts the asking and keeps the subject', () => {
      // Otherwise every card begins "Can you show me…" and the half that tells
      // them apart is the half that truncates.
      expect(chatTitle('can you show me the ten busiest days')).toBe('The ten busiest days');
      expect(chatTitle('Please give me the top artists')).toBe('The top artists');
      expect(chatTitle('I want to see the schema')).toBe('See the schema');
      expect(chatTitle('hey, could you help me find duplicate rows')).toBe(
        'Find duplicate rows'
      );
    });

    it('keeps the question when the preamble is all there was', () => {
      // Cutting this to nothing would leave a card with no name at all.
      expect(chatTitle('show me')).toBe('Show me');
      expect(chatTitle('can you')).toBe('Can you');
    });
  });

  describe('length', () => {
    it('leaves a short title alone', () => {
      const short = 'Rows per table';
      expect(chatTitle(short)).toBe(short);
    });

    it('cuts a long one at a word boundary, with an ellipsis', () => {
      const title = chatTitle(
        'the total revenue by region and channel for every month of the last three years'
      );
      expect(title.length).toBeLessThanOrEqual(49);
      expect(title.endsWith('…')).toBe(true);
      // Never mid-word.
      expect(title.slice(0, -1)).not.toMatch(/\s$/);
      expect(title).toMatch(/^The total revenue by region and channel/);
    });

    it('cuts a single enormous word rather than giving up on it', () => {
      const title = chatTitle('a'.repeat(120));
      expect(title.length).toBeLessThanOrEqual(49);
      expect(title.endsWith('…')).toBe(true);
    });
  });

  it('has nothing to say about nothing', () => {
    expect(chatTitle('')).toBe('');
    expect(chatTitle('   \n  ')).toBe('');
  });
});
