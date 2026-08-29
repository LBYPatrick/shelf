import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_LIMIT,
  attachmentKind,
  imagesOf,
  questionWithAttachments,
} from '@shared/aiAttachments';

const text = (name: string, body: string) => ({ kind: 'text' as const, name, text: body });

describe('what a file can be sent as', () => {
  it('takes the four picture formats the providers agree on', () => {
    expect(attachmentKind('shot.png', 'image/png')).toBe('image');
    expect(attachmentKind('shot.webp', 'image/webp')).toBe('image');
    // Not `image/*`: a TIFF that fails at the far end is worse than a refusal
    // here, where it can be explained.
    expect(attachmentKind('scan.tiff', 'image/tiff')).toBeNull();
  });

  it('reads anything textual as text', () => {
    expect(attachmentKind('dump.sql', 'text/plain')).toBe('text');
    expect(attachmentKind('rows.csv', 'text/csv')).toBe('text');
    expect(attachmentKind('config.json', 'application/json')).toBe('text');
  });

  /*
   * A file dragged into an Electron window very often arrives with an empty
   * type, so the name has to be enough on its own.
   */
  it('falls back to the name when the OS says nothing', () => {
    expect(attachmentKind('schema.sql', '')).toBe('text');
    expect(attachmentKind('query.log', '')).toBe('text');
    expect(attachmentKind('archive.zip', '')).toBeNull();
    expect(attachmentKind('noextension', '')).toBeNull();
  });
});

describe('a question with files attached', () => {
  it('is unchanged when nothing is attached', () => {
    expect(questionWithAttachments('why is this slow?')).toBe('why is this slow?');
    expect(questionWithAttachments('why?', [])).toBe('why?');
  });

  it('puts the files under the question, not over it', () => {
    const composed = questionWithAttachments('what is wrong?', [text('a.sql', 'select 1')]);
    expect(composed.indexOf('what is wrong?')).toBeLessThan(composed.indexOf('select 1'));
    expect(composed).toContain('Attached file: a.sql');
    expect(composed).toContain('```sql');
  });

  it('carries every text attachment, in order', () => {
    const composed = questionWithAttachments('?', [text('a.csv', 'AAA'), text('b.csv', 'BBB')]);
    expect(composed.indexOf('AAA')).toBeLessThan(composed.indexOf('BBB'));
  });

  /*
   * A file with three backticks in it closes a three-backtick fence early, and
   * everything after it reads as prose rather than as the file.
   */
  it('uses a fence the content cannot close', () => {
    const composed = questionWithAttachments('?', [text('r.md', 'a\n```\nb\n```\nc')]);
    expect(composed).toContain('````');
    // The whole file is still in there, fence and all.
    expect(composed).toContain('a\n```\nb\n```\nc');
  });

  /*
   * Cut, and said to be cut. A truncated document presented as whole turns a
   * wrong answer into an unattributable one.
   */
  it('cuts a file that is too long, and says so', () => {
    const composed = questionWithAttachments('?', [
      text('big.log', 'x'.repeat(ATTACHMENT_LIMIT * 2)),
    ]);
    expect(composed).toContain('Cut off at');
    expect(composed.length).toBeLessThan(ATTACHMENT_LIMIT * 2);
  });

  it('leaves pictures out of the text entirely', () => {
    const image = {
      kind: 'image' as const,
      name: 'a.png',
      mediaType: 'image/png',
      base64: 'AAAA',
    };
    expect(questionWithAttachments('look', [image])).toBe('look');
    expect(imagesOf([image, text('a.sql', 'select 1')])).toEqual([
      { mediaType: 'image/png', base64: 'AAAA' },
    ]);
  });
});
