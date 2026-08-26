/**
 * SQL, split into the pieces that get coloured.
 *
 * The editor has Monaco and the grid has its own renderer; a statement sitting
 * in a conversation has neither, and it was drawn as plain monospace text.
 * That is the one place in the app where SQL appears without any of the shape
 * a reader uses to scan it — where the keywords are, where the strings end.
 *
 * Mounting an editor per block was the obvious fix and is the wrong one: a turn
 * can contain half a dozen statements, and half a dozen Monaco instances inside
 * a scrolling transcript is a monitor's worth of workers and observers for
 * something nobody types into.
 *
 * So: a tokeniser. It is deliberately not a parser — colouring does not require
 * knowing what a statement *means*, only where its literals and its words are,
 * and nine engines mean nine grammars but one lexical shape. The colours it
 * feeds are `--syntax-*`, the same tokens the editor's theme is built from, so
 * a block in a chat and the same text in the editor are coloured alike and both
 * follow the accent.
 *
 * Pure, and unit tested, because the failure mode is silent: an unterminated
 * string swallowing the rest of a statement looks like a colour scheme choice.
 */

export type TokenKind =
  | 'keyword'
  | 'type'
  | 'function'
  | 'string'
  | 'number'
  | 'comment'
  | 'operator'
  | 'punctuation'
  | 'identifier'
  /** Quoted identifiers, which are names rather than values. */
  | 'quoted'
  | 'plain';

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
}

/**
 * The words worth colouring, and only those.
 *
 * Not every reserved word in every dialect — that list is thousands long, it
 * disagrees between engines, and colouring all of it makes a statement where
 * nothing stands out because everything does. These are the words that carry
 * the shape of a statement.
 */
const KEYWORDS = new Set(
  `select from where group by having order limit offset insert into values update set delete
   create alter drop truncate table view index unique primary key foreign references constraint
   join inner left right full outer cross on using union all except intersect distinct as
   and or not in is null like ilike between exists case when then else end asc desc
   with recursive returning conflict do nothing explain analyze analyse begin commit rollback
   grant revoke add column rename to if cascade restrict default check
   over partition window rows range preceding following unbounded current row
   inner outer natural lateral fetch next only for share nowait`
    .split(/\s+/)
    .filter(Boolean)
);

/** Type names, coloured apart from keywords because they name a shape. */
const TYPES = new Set(
  `int integer bigint smallint serial bigserial decimal numeric real double precision float
   char varchar text bytea blob clob boolean bool date time timestamp timestamptz interval
   uuid json jsonb xml array enum money inet cidr macaddr`
    .split(/\s+/)
    .filter(Boolean)
);

const WORD = /[A-Za-z_][\w$]*/y;
const NUMBER = /\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const OPERATOR = /(?:\|\||::|<>|!=|>=|<=|=>|->>|->|[+\-*/%<>=~!@#&|^])+/y;

/**
 * Reads one statement into tokens.
 *
 * Every branch consumes at least one character, so this cannot loop: the
 * fallback at the bottom takes a character and moves on rather than trying to
 * classify it, which is what keeps a stray byte from a dialect we have never
 * seen out of the failure paths.
 */
export function tokenizeSql(sql: string): readonly Token[] {
  const tokens: Token[] = [];
  let at = 0;

  const push = (kind: TokenKind, text: string): void => {
    // Runs of the same kind are merged, so the renderer emits one span for a
    // stretch of whitespace and punctuation rather than one per character.
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind)
      tokens[tokens.length - 1] = { kind, text: last.text + text };
    else tokens.push({ kind, text });
  };

  while (at < sql.length) {
    const char = sql[at]!;

    // Whitespace, kept verbatim: the block is `white-space: pre`.
    if (/\s/.test(char)) {
      push('plain', char);
      at += 1;
      continue;
    }

    // A line comment runs to the newline; a block comment to its terminator, or
    // to the end if it was never closed.
    if (char === '-' && sql[at + 1] === '-') {
      const end = sql.indexOf('\n', at);
      const stop = end === -1 ? sql.length : end;
      push('comment', sql.slice(at, stop));
      at = stop;
      continue;
    }

    if (char === '/' && sql[at + 1] === '*') {
      const end = sql.indexOf('*/', at + 2);
      const stop = end === -1 ? sql.length : end + 2;
      push('comment', sql.slice(at, stop));
      at = stop;
      continue;
    }

    /*
     * A string literal, with the doubled quote that escapes one inside it.
     * Unterminated, it takes the rest of the text — which is what the engine
     * would do too, and colouring it as a string is how the reader sees that
     * they are missing a quote.
     */
    if (char === "'") {
      let cursor = at + 1;
      while (cursor < sql.length) {
        if (sql[cursor] === "'") {
          if (sql[cursor + 1] === "'") cursor += 2;
          else {
            cursor += 1;
            break;
          }
        } else cursor += 1;
      }
      push('string', sql.slice(at, cursor));
      at = cursor;
      continue;
    }

    // A quoted identifier is a *name*, not a value, and is coloured as one.
    if (char === '"' || char === '`' || char === '[') {
      const closer = char === '[' ? ']' : char;
      const end = sql.indexOf(closer, at + 1);
      const stop = end === -1 ? sql.length : end + 1;
      push('quoted', sql.slice(at, stop));
      at = stop;
      continue;
    }

    if (/\d/.test(char)) {
      NUMBER.lastIndex = at;
      const match = NUMBER.exec(sql);
      if (match) {
        push('number', match[0]);
        at += match[0].length;
        continue;
      }
    }

    if (/[A-Za-z_]/.test(char)) {
      WORD.lastIndex = at;
      const match = WORD.exec(sql);
      if (match) {
        const word = match[0];
        const lower = word.toLowerCase();

        // A word immediately before an opening bracket is being called, which
        // is the only way to tell `count` the function from `count` the column
        // without knowing the schema.
        const isCall = /^\s*\(/.test(sql.slice(at + word.length));

        if (KEYWORDS.has(lower) && !isCall) push('keyword', word);
        else if (TYPES.has(lower)) push('type', word);
        else if (isCall) push('function', word);
        else push('identifier', word);

        at += word.length;
        continue;
      }
    }

    OPERATOR.lastIndex = at;
    const operator = OPERATOR.exec(sql);
    if (operator) {
      push('operator', operator[0]);
      at += operator[0].length;
      continue;
    }

    if ('(),;.'.includes(char)) {
      push('punctuation', char);
      at += 1;
      continue;
    }

    // Anything else at all. One character, so the loop always advances.
    push('plain', char);
    at += 1;
  }

  return tokens;
}
