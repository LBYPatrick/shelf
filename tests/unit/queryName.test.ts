import { describe, expect, it } from 'vitest';
import { namePrompt, tidyGeneratedName } from '@shared/queryName';

describe('namePrompt', () => {
  it('asks for the reply and nothing else', () => {
    expect(namePrompt()).toContain('nothing else');
  });

  /*
   * The exemption is the load-bearing half. Without it a model told to answer
   * in Chinese translates the column it was shown, and the name points at
   * something the database does not have.
   */
  it('names the language, and exempts identifiers from it', () => {
    const prompt = namePrompt('ja');
    expect(prompt).toContain('ja');
    expect(prompt).toMatch(/table and column names exactly as they are spelled/);
  });

  it('says nothing about a language when there is none to say', () => {
    expect(namePrompt()).not.toContain('BCP-47');
  });
});

describe('tidyGeneratedName', () => {
  it('keeps a name that is already one', () => {
    expect(tidyGeneratedName('Albums per artist')).toBe('Albums per artist');
  });

  it('drops the announcement a model makes before answering', () => {
    expect(tidyGeneratedName("Sure! Here's a title: Albums per artist")).toBe(
      'Albums per artist'
    );
  });

  it('unwraps quotes, backticks and markdown emphasis', () => {
    expect(tidyGeneratedName('"Albums per artist"')).toBe('Albums per artist');
    expect(tidyGeneratedName('`Albums per artist`')).toBe('Albums per artist');
    expect(tidyGeneratedName('**Albums per artist**')).toBe('Albums per artist');
  });

  it('takes the first line when the model explains itself afterwards', () => {
    expect(
      tidyGeneratedName('Albums per artist\n\nThis counts albums grouped by artist.')
    ).toBe('Albums per artist');
  });

  /*
   * The preamble strip is bounded and conditional for this: a name that has a
   * colon in it is a name, not an announcement, and eating up to the colon
   * would leave the reader with half of what the model said.
   */
  it('keeps a colon that belongs to the name', () => {
    expect(tidyGeneratedName('Revenue: last quarter')).toBe('Revenue: last quarter');
    expect(tidyGeneratedName('Orders: unshipped')).toBe('Orders: unshipped');
  });

  /* One word, but never part of a title — the closed set the rule names. */
  it('drops a bare label in front of the name', () => {
    expect(tidyGeneratedName('Title: Albums per artist')).toBe('Albums per artist');
    expect(tidyGeneratedName('Name: Albums per artist')).toBe('Albums per artist');
  });

  it('cuts a sentence back to a name, at a word', () => {
    const long =
      'Counts the albums released by every artist in the catalogue, ordered by how many';
    const name = tidyGeneratedName(long);
    expect(name.length).toBeLessThanOrEqual(60);
    expect(long.startsWith(name)).toBe(true);
    expect(name).not.toMatch(/\s$/);
    // Cut at a word, not through one.
    expect(long[name.length]).toBe(' ');
  });

  it('does not cut a single long token in half', () => {
    const token = 'a'.repeat(80);
    expect(tidyGeneratedName(token)).toBe('a'.repeat(60));
  });

  /*
   * Empty rather than a placeholder. Every caller already has a default worth
   * more than "Untitled" — the tab's name, or the job's timestamp — and a
   * model that returned nothing must not overwrite it.
   */
  it('gives back nothing when there is nothing to give', () => {
    expect(tidyGeneratedName('')).toBe('');
    expect(tidyGeneratedName('   \n  ')).toBe('');
    expect(tidyGeneratedName('""')).toBe('');
  });
});
