/**
 * What to call a conversation, given how it started.
 *
 * Derived from the first question rather than asked for. A model could write a
 * better title, and every chat client does exactly that — but it costs a round
 * trip, it costs money, and it arrives *after* the card it is meant to label,
 * so the list shows "New chat" for a second and then changes under the reader.
 * The first thing someone types is already a description of what they want;
 * this is mostly a matter of not mangling it.
 *
 * Pure and unit tested, because the failure is silent and permanent: a title is
 * written once, at the moment the conversation is created, and a bad one is
 * then the name of that conversation for as long as it is kept.
 */

/** Past this a card would truncate anyway, and a truncated title is a worse title. */
const MAX = 48;

/**
 * Openers that describe the *asking* rather than the subject.
 *
 * "Can you show me the ten busiest days" is a card that says "Can you show me
 * the ten busiest…" — the distinguishing half is what falls off the end. Cut
 * the preamble and the title becomes the question.
 */
const PREAMBLE =
  /^(?:(?:hey|hi|hello|ok|okay|so|please|pls)[,\s]+)*(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:help\s+me\s+)?(?:(?:show|tell|give)\s+me\s+)?(?:i\s+(?:want|need)\s+(?:to\s+)?)?/i;

export function chatTitle(question: string): string {
  /*
   * The line break is read before the whitespace is collapsed, and that order
   * is the whole of it: collapsing first turns "why is this slow" followed by a
   * pasted query into one long line, and the title becomes the query.
   */
  const firstLine = question.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
  const collapsed = firstLine.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';

  // And only the first sentence of it: a question with its reasoning attached
  // is still one question.
  const opening = collapsed.split(/(?<=[.?!])\s/)[0] ?? collapsed;

  const bare = opening.replace(PREAMBLE, '').trim();
  const chosen = bare.length >= 3 ? bare : opening;

  // Trailing punctuation is noise on a label; a closing bracket is not.
  const trimmed = chosen.replace(/[\s,.;:?!]+$/, '');

  const capped = cap(trimmed);
  return capped.charAt(0).toUpperCase() + capped.slice(1);
}

/** Cut at a word boundary, never mid-word, and only if there is a boundary to use. */
function cap(text: string): string {
  if (text.length <= MAX) return text;

  const clipped = text.slice(0, MAX);
  const lastSpace = clipped.lastIndexOf(' ');
  // A single very long word has no boundary; cutting it anywhere is the same,
  // so it is cut at the limit rather than thrown away.
  const body = lastSpace > MAX * 0.6 ? clipped.slice(0, lastSpace) : clipped;
  return `${body.replace(/[\s,.;:]+$/, '')}…`;
}
