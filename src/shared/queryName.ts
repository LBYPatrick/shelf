/**
 * Asking a model for a name, and making what it says usable.
 *
 * Naming a saved query or a dispatched job is the one part of both flows that
 * nobody wants to do: the statement is already written, the dialog is in the
 * way, and "Untitled" is one keystroke closer than a name. So the model is
 * offered as a way of filling the field — never as the thing that fills it,
 * because a name the reader did not choose is a name they will not recognise
 * in a list a week later.
 *
 * Pure, and unit tested, because everything here is a guess about what a model
 * will do with an instruction it was given once. A model told "no quotes"
 * returns quotes; told "under six words" returns a sentence; told to answer
 * with a name returns "Sure! Here's a name:" and then the name. None of that
 * is an error the caller can see — it is a plausible string that goes straight
 * into a field — so it is trimmed off here rather than hoped away in the
 * prompt.
 */

/** As long as a name can be before it stops being one and starts being prose. */
const MAX_LENGTH = 60;

/**
 * What a name may not begin with.
 *
 * A model asked for one thing and answering with a sentence nearly always
 * announces itself first — "Sure! Here's a title: …". But a colon is also how
 * a perfectly good name is qualified, and "Revenue: last quarter" must survive
 * intact, so the colon alone cannot be the signal.
 *
 * Two things separate the announcement from the label, and both are needed. An
 * announcement is a clause, so it runs to three words or more; and the handful
 * of one-word openings a model actually uses are a closed set worth naming,
 * because "Title" in front of a colon is never part of the title.
 */
const LEAD_IN = /^([^:\n]{1,40}):\s*(?=\S)/;
const LABELS = new Set(['title', 'name', 'answer', 'suggestion']);

function withoutLeadIn(line: string): string {
  const match = LEAD_IN.exec(line);
  if (!match) return line;

  const prefix = match[1]!.trim();
  const words = prefix.split(/\s+/);
  const bare = prefix.toLowerCase().replace(/[^a-z]/g, '');
  if (words.length < 3 && !LABELS.has(bare)) return line;

  return line.slice(match[0].length);
}

/** Wrapping a name in quotes, backticks or markdown is the commonest of these. */
const WRAPPERS = /^[`"'*_\s]+|[`"'*_\s]+$/g;

/**
 * The instruction, in the one shape every provider here agrees on.
 *
 * `locale` is the interface's language, and it settles what the SQL cannot: a
 * statement is not written in a human language, so unlike a question in a
 * conversation there is nothing in the input to read the answer's language
 * off. Identifiers are exempted explicitly, for the same reason the assistant's
 * prompt exempts them — told to answer in Chinese, a model translates
 * `play_count` and leaves the reader hunting for a column that does not exist.
 */
export function namePrompt(locale?: string): string {
  return [
    'You name SQL statements. Given one, reply with a short title describing what it',
    'returns or does — at most six words, in sentence case, with no trailing full stop.',
    'Reply with the title and nothing else: no quotes, no preamble, no explanation.',
    'Name the result, not the syntax: “Albums per artist”, never “A SELECT with a JOIN”.',
    locale
      ? `Write it in the language with BCP-47 tag ${locale}, but leave table and column ` +
        'names exactly as they are spelled in the statement.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * The model's reply, as a name.
 *
 * Falls back to the empty string rather than to a placeholder: the caller has a
 * default already — the tab's own name, or the job's stamp — and replacing a
 * real default with "Untitled" because a model returned nothing is worse than
 * leaving the field as it was.
 */
export function tidyGeneratedName(raw: string): string {
  const firstLine = raw.trim().split('\n')[0]?.trim() ?? '';
  const bare = withoutLeadIn(firstLine).replace(WRAPPERS, '').trim();
  if (!bare) return '';

  if (bare.length <= MAX_LENGTH) return bare;

  /*
   * Cut at a word rather than mid-word, and only if there is a word boundary
   * worth cutting at — a sixty-character run with no space in it is one token
   * of something, and half of it is not a shorter name but a wrong one.
   */
  const clipped = bare.slice(0, MAX_LENGTH);
  const lastSpace = clipped.lastIndexOf(' ');
  return (lastSpace > MAX_LENGTH / 2 ? clipped.slice(0, lastSpace) : clipped).trim();
}
