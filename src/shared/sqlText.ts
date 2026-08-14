/**
 * Reading SQL as text, without parsing it.
 *
 * Splitting on semicolons is the whole job, and the whole difficulty: a
 * semicolon inside a string literal or a comment is not a statement boundary,
 * and a client that cuts a statement in half there runs half a statement.
 *
 * Deliberately not a parser. Knowing where the statements are does not require
 * knowing what they mean, and every engine means something slightly different.
 */

export interface Statement {
  readonly text: string;
  /** Offsets into the original text, so the editor can mark the range. */
  readonly from: number;
  readonly to: number;
}

/**
 * Finds the statement containing the cursor by walking outward to the nearest
 * semicolons. Semicolons inside string literals and comments are skipped, so a
 * statement containing `';'` is not cut in half.
 */
export function statementAt(text: string, position: number): Statement {
  const boundaries = [0];

  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (inSingle) {
      if (char === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (char === '"') inDouble = false;
      continue;
    }

    if (char === '-' && next === '-') inLineComment = true;
    else if (char === '/' && next === '*') inBlockComment = true;
    else if (char === "'") inSingle = true;
    else if (char === '"') inDouble = true;
    else if (char === ';') boundaries.push(index + 1);
  }

  boundaries.push(text.length);

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const from = boundaries[index]!;
    const to = boundaries[index + 1]!;
    if (position >= from && position <= to) {
      const slice = text.slice(from, to);
      const leading = slice.length - slice.trimStart().length;
      return {
        text: slice.trim(),
        from: from + leading,
        to: from + leading + slice.trim().length,
      };
    }
  }

  return { text: text.trim(), from: 0, to: text.length };
}
