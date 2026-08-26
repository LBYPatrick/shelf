/**
 * What a statement would do, before anyone runs it.
 *
 * The assistant can run SQL, and "can run SQL" is the whole trust question of
 * this feature. The answer is not a dialog per statement — a permission prompt
 * that appears for `SELECT 1` is a prompt people learn to click through, and
 * the one time it matters they click through that too. It is a *classification*:
 * reads go through, anything that writes stops and asks by name.
 *
 * Deliberately not a parser, for the same reason `sqlText.ts` is not one: nine
 * engines mean nine grammars, and the question here is answered by the first
 * keyword in every one of them. The classification errs toward `write` —
 * anything unrecognised is treated as something that could change data, because
 * the cost of being wrong in that direction is a question the reader answers
 * and the cost of being wrong in the other is data.
 *
 * Pure, and unit tested, because a mistake here is silent by construction: a
 * misclassified `DELETE` produces no error, only a table with fewer rows in it.
 */

export type SqlEffect =
  /** Returns rows and changes nothing. */
  | 'read'
  /** Changes rows. */
  | 'write'
  /** Changes the shape of the database. */
  | 'schema'
  /** Could not be recognised, and is therefore treated as a write. */
  | 'unknown';

const READ = new Set([
  'select',
  'with',
  'show',
  'describe',
  'desc',
  'explain',
  'pragma',
  'values',
  'table',
]);

const WRITE = new Set([
  'insert',
  'update',
  'delete',
  'merge',
  'upsert',
  'replace',
  'copy',
  'load',
  'call',
  'do',
  'begin',
  'commit',
  'rollback',
  'savepoint',
  'set',
  'reset',
  'vacuum',
  'analyze',
  'reindex',
  'refresh',
  'lock',
  'grant',
  'revoke',
]);

const SCHEMA = new Set([
  'create',
  'alter',
  'drop',
  'truncate',
  'rename',
  'comment',
  'attach',
  'detach',
]);

/** Strips comments and leading noise so the first word is really the first word. */
function firstKeyword(sql: string): string {
  const bare = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[\s(]+/, '')
    .trim();

  const match = /^[a-z_]+/i.exec(bare);
  return match ? match[0].toLowerCase() : '';
}

/**
 * `EXPLAIN ANALYZE` is the trap in this list.
 *
 * `EXPLAIN` reads, `ANALYZE` writes, and Postgres's `EXPLAIN ANALYZE` *runs the
 * statement* — so a plan requested for a `DELETE` deletes. Reading only the
 * first word would wave it through as a read.
 *
 * The options may be bare words or a parenthesised list, and either form may
 * carry a value: `EXPLAIN ANALYZE`, `EXPLAIN (ANALYZE true)`, and
 * `EXPLAIN (ANALYZE, BUFFERS)` all execute, while `EXPLAIN (ANALYZE false)`
 * does not. So the options are consumed one at a time until the statement
 * itself is what is left, and *that* is what gets classified.
 */
const EXPLAIN_OPTION =
  /^\s*(analyz[es]e?|verbose|costs|settings|generic_plan|buffers|serialize|wal|timing|summary|memory|format)\b(\s+(on|off|true|false|text|json|xml|yaml))?,?/i;

function explainEffect(sql: string): SqlEffect {
  let rest = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[\s(]+/, '')
    .replace(/^explain\b/i, '');

  let executes = false;

  for (;;) {
    const group = /^\s*\(([^)]*)\)/.exec(rest);
    if (group) {
      if (/\banalyz[es]e?\b(?!\s*(?:false|off|0))/i.test(group[1] ?? '')) executes = true;
      rest = rest.slice(group[0].length);
      continue;
    }

    const option = EXPLAIN_OPTION.exec(rest);
    if (option) {
      if (/^\s*analyz/i.test(option[0]) && !/\b(?:false|off|0)\b/i.test(option[0])) {
        executes = true;
      }
      rest = rest.slice(option[0].length);
      continue;
    }

    break;
  }

  // Without ANALYZE the server only plans, whatever the statement would have
  // done — so the plan of a DELETE is a read.
  return executes ? classifyStatement(rest) : 'read';
}

export function classifyStatement(sql: string): SqlEffect {
  const keyword = firstKeyword(sql);
  if (!keyword) return 'unknown';
  if (keyword === 'explain') return explainEffect(sql);

  /*
   * A CTE is a read right up until it is not: Postgres allows
   * `WITH x AS (...) DELETE FROM ...`, and SQL Server allows the same shape.
   * The leading keyword says nothing, so the statement is searched for a
   * writing verb outside its string literals.
   */
  if (keyword === 'with') {
    const bare = sql.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
    if (/\b(insert|update|delete|merge)\b/i.test(bare)) return 'write';
    return 'read';
  }

  if (READ.has(keyword)) return 'read';
  if (SCHEMA.has(keyword)) return 'schema';
  if (WRITE.has(keyword)) return 'write';
  return 'unknown';
}

/**
 * The effect of a script, which is the effect of its loudest statement.
 *
 * A script that reads four times and writes once is a write. Reporting the
 * first statement's effect would let a write ride in behind a `SELECT`.
 */
export function classifyScript(statements: readonly string[]): SqlEffect {
  const order: readonly SqlEffect[] = ['read', 'write', 'unknown', 'schema'];
  let worst: SqlEffect = 'read';
  for (const statement of statements) {
    const effect = classifyStatement(statement);
    if (order.indexOf(effect) > order.indexOf(worst)) worst = effect;
  }
  return worst;
}

/** Whether a statement may run without being shown to the reader first. */
export function isReadOnly(sql: string): boolean {
  return classifyStatement(sql) === 'read';
}
