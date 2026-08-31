/**
 * A name for a copy of something, that is not already taken.
 *
 * Two lists need this and they need it to agree: a saved query and a database
 * connection are both named things in a list you can duplicate, and "Albums
 * copy" beside "Albums copy 2" beside "Albums (copy)" is three answers to one
 * question. It is here rather than in either of them for that reason, and
 * because the numbering is the part that is easy to get subtly wrong.
 *
 * Duplicating a copy does not stack the word: "Albums copy" duplicates to
 * "Albums copy 2", not "Albums copy copy". Finder's rule, and the reason for it
 * is that the alternative grows without bound in the one place — a list of
 * near-identical rows — where the name is all you have to tell them apart.
 *
 * The word is a parameter because it is shown to the reader and this app is
 * translated. Everything else here is arithmetic.
 */
export function copyName(name: string, taken: Iterable<string>, word: string): string {
  const base = name.trim() || word;
  const existing = new Set(taken);

  /*
   * Strip a suffix this function put there, so the count continues rather than
   * restarting. Escaped, because the word arrives from a translation bundle and
   * a language whose word for "copy" contains a regular-expression character is
   * not a thing to find out about in production.
   */
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stem = base.replace(new RegExp(`(?:^|\\s+)${escaped}(?:\\s+\\d+)?$`), '').trim();

  // Nothing left once the word is stripped means the name *was* the word.
  const first = stem ? `${stem} ${word}` : word;
  if (!existing.has(first)) return first;

  // From 2, because the unnumbered one is the first.
  for (let nth = 2; ; nth += 1) {
    const candidate = `${first} ${nth}`;
    if (!existing.has(candidate)) return candidate;
  }
}
