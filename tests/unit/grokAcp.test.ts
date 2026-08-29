import { describe, expect, it } from 'vitest';
import { chunkText, stopOf } from '@ai/drivers/grok';

/**
 * The two places the Grok driver reads a shape it did not build.
 *
 * Everything else about it is a subprocess and a socket, which an end-to-end
 * test covers and a unit test cannot. These two are the parts that decide what
 * the reader is shown, from JSON somebody else's program wrote — the same
 * reason the conformance suite asserts shapes rather than assuming them.
 */

describe('a session/update chunk', () => {
  it('reads the text out of a content block', () => {
    expect(
      chunkText({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } })
    ).toBe('hi');
  });

  /*
   * A block that is not text is a block this app has no view for — an image, an
   * audio clip, a resource link. Reading a `text` field off one that has none
   * yields `undefined`, and `undefined` appended to an answer is the string
   * "undefined" in the middle of a sentence.
   */
  it('ignores a block that is not text', () => {
    expect(chunkText({ content: { type: 'image', data: 'AAAA' } })).toBe('');
    expect(chunkText({ content: { type: 'resource_link', uri: 'file:///x' } })).toBe('');
  });

  it('survives an update with nothing in it', () => {
    expect(chunkText({})).toBe('');
    expect(chunkText({ content: null })).toBe('');
    expect(chunkText({ content: 'text' })).toBe('');
  });
});

describe('a stop reason', () => {
  it('carries a refusal and a limit, which mean different things', () => {
    expect(stopOf('refusal')).toBe('refusal');
    expect(stopOf('max_tokens')).toBe('length');
    expect(stopOf('max_turn_requests')).toBe('length');
  });

  it('reads an ordinary ending as one', () => {
    expect(stopOf('end_turn')).toBe('end');
    expect(stopOf('cancelled')).toBe('end');
  });

  /*
   * A protocol adds words. A driver that threw on one it had not been taught
   * would stop working the day the CLI updated, having received a complete
   * answer it then refused to hand over.
   */
  it('treats a word it has not been taught as an ending', () => {
    expect(stopOf('something_new')).toBe('end');
    expect(stopOf(undefined)).toBe('end');
  });
});
