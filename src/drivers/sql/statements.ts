import { identify } from 'sql-query-identifier';
import type { EntityRef } from '../types';

/**
 * Reading a SQL script well enough to run it and to know what it touched.
 */

/** Splits a script into statements, tolerating semicolons inside literals. */
export function splitStatements(text: string): string[] {
  try {
    return identify(text, { strict: false })
      .map((statement) => statement.text.trim())
      .filter((statement) => statement.length > 0);
  } catch {
    // The parser does not know every dialect extension. Running the script as
    // one statement is better than refusing to run it at all.
    const trimmed = text.trim();
    return trimmed ? [trimmed] : [];
  }
}

const FROM_PATTERN = /\bfrom\s+(?:(["`[])?([\w$]+)\1?\s*\.\s*)?(["`[])?([\w$]+)\3?/i;

/**
 * The single table a result's rows came from, if there is one.
 *
 * Editing a grid means writing a value back to a specific row of a specific
 * table. A join, a union or a subquery has no single source, and guessing would
 * mean writing to the wrong place — so those return undefined and the grid
 * explains why the cell is locked instead.
 */
export function singleSourceTable(text: string): EntityRef | undefined {
  const withoutComments = text.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

  const match = FROM_PATTERN.exec(withoutComments);
  if (!match) return undefined;

  // Anything that combines tables makes the mapping ambiguous.
  if (/\bjoin\b|\bunion\b|\bexcept\b|\bintersect\b/i.test(withoutComments)) return undefined;

  // A comma between FROM and the next clause is an old-style join.
  const afterFrom = withoutComments.slice(match.index + match[0].length);
  const beforeNextClause =
    afterFrom.split(/\bwhere\b|\bgroup\b|\border\b|\blimit\b|\bhaving\b/i)[0] ?? '';
  if (beforeNextClause.includes(',')) return undefined;

  const schema = match[2];
  const name = match[4];
  if (!name) return undefined;

  return schema ? { name, schema } : { name };
}
