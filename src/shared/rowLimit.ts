/**
 * Asking the server for a preview, rather than for everything.
 *
 * The row limit used to be a cut made after the fact: every driver ran the
 * statement as written, waited for the whole result, and kept the first five
 * hundred rows of it. On a table of any size that is the slowest possible way
 * to look at five hundred rows — the server sorts and materialises the lot, the
 * wire carries the lot, and the interface throws almost all of it away. The
 * limit has to be in the statement to mean anything.
 *
 * It is appended rather than wrapped. `SELECT * FROM (…) AS t LIMIT n` is the
 * form that survives any statement, and it is also the form that changes what
 * the statement *is*: duplicate column names collapse, `FOR UPDATE` becomes
 * invalid, and the plan the server chooses is a plan for a different query.
 * Appending leaves the statement the reader wrote intact.
 *
 * Every engine this applies to spells it `LIMIT n`. The engines that do not —
 * Oracle's `FETCH FIRST`, SQL Server's `TOP` — are not among them, and if one
 * arrives it declares itself here rather than being discovered at runtime.
 */

/**
 * The value meaning "no limit at all".
 *
 * A sentinel rather than zero, because zero is a number the comparisons in
 * every driver would happily honour: `rows.length > 0` truncates a result to
 * nothing, and the bug would be a blank grid rather than an error.
 */
export const UNLIMITED = Number.MAX_SAFE_INTEGER;

/** Statements that return rows, and can therefore be limited. */
const RETURNS_ROWS = /^\s*(?:select|with|values|table)\b/i;

/**
 * A limit already stated, anywhere in the text.
 *
 * Conservative on purpose: a `LIMIT` inside a subquery is not the statement's
 * own limit, but telling the two apart needs a parser, and the cost of being
 * wrong in this direction is only that the old behaviour applies — the whole
 * result comes back and is cut here. The cost of being wrong in the other
 * direction is a statement that no longer runs.
 */
const ALREADY_LIMITED = /\b(?:limit|fetch\s+(?:first|next)|offset)\b/i;

/**
 * Clauses that must be the last thing in the statement, so nothing may be
 * appended after them.
 */
const TRAILING_CLAUSE = /\b(?:for\s+(?:update|share|no\s+key\s+update|key\s+share)|into\s+\w)/i;

/**
 * The statement to actually run, given how many rows the reader asked to see.
 *
 * Returns the text unchanged whenever the limit cannot be applied honestly,
 * which is the safe answer: the driver still cuts the result to size, exactly
 * as it did before this existed.
 *
 * One more row is asked for than is wanted, so that "there were more" remains a
 * fact the driver observed rather than a guess. A statement limited to exactly
 * `maxRows` is indistinguishable from a table that happens to hold that many.
 */
export function limitStatement(sql: string, maxRows: number): string {
  if (!Number.isFinite(maxRows) || maxRows <= 0 || maxRows >= UNLIMITED) return sql;

  const text = sql.replace(/;\s*$/, '');
  if (!RETURNS_ROWS.test(text)) return sql;
  if (ALREADY_LIMITED.test(text) || TRAILING_CLAUSE.test(text)) return sql;

  /*
   * On its own line, so a statement ending in a `--` comment still runs: the
   * comment ends at the newline, and the limit is on the far side of it.
   */
  return `${text}\nLIMIT ${maxRows + 1}`;
}
