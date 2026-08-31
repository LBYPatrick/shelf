import { describe, expect, it } from 'vitest';
import { copyName } from '@shared/copyName';

const COPY = 'copy';

describe('naming a duplicate', () => {
  it('adds the word when nothing is in the way', () => {
    expect(copyName('Albums', [], COPY)).toBe('Albums copy');
  });

  it('numbers from two, because the unnumbered one is the first', () => {
    expect(copyName('Albums', ['Albums copy'], COPY)).toBe('Albums copy 2');
    expect(copyName('Albums', ['Albums copy', 'Albums copy 2'], COPY)).toBe('Albums copy 3');
  });

  it('fills a gap rather than counting past it', () => {
    expect(copyName('Albums', ['Albums copy', 'Albums copy 3'], COPY)).toBe('Albums copy 2');
  });

  it('does not stack the word when a copy is copied', () => {
    // "Albums copy copy copy" grows without bound in the one place the name is
    // all you have to tell two near-identical rows apart.
    expect(copyName('Albums copy', ['Albums copy'], COPY)).toBe('Albums copy 2');
    expect(copyName('Albums copy 2', ['Albums copy', 'Albums copy 2'], COPY)).toBe(
      'Albums copy 3'
    );
  });

  it('takes the word from the caller, so it can be translated', () => {
    expect(copyName('Albums', [], '副本')).toBe('Albums 副本');
    expect(copyName('Albums 副本', ['Albums 副本'], '副本')).toBe('Albums 副本 2');
  });

  it('survives a word with a regular-expression character in it', () => {
    expect(copyName('Albums (c)', [], '(c)')).toBe('Albums (c)');
    expect(copyName('Albums', ['Albums (c)'], '(c)')).toBe('Albums (c) 2');
  });

  it('falls back to the word when there is no name to build on', () => {
    expect(copyName('   ', [], COPY)).toBe('copy');
  });
});
