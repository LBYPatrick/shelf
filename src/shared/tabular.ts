/**
 * Rendering a result set as text.
 *
 * These are for the clipboard, where the whole point is that what you paste is
 * what you were looking at. Writing a *file* goes through the host instead, so
 * the rows stream to disk without ever entering this process — a result set
 * worth exporting is usually one too big to hold twice.
 */
import type { CellValue, Field } from '../drivers/types';
import { displayValue, isTagged } from './values';

/**
 * How a value reads once it is text.
 *
 * This used to be a local `asText` that fell through to `JSON.stringify` for
 * anything object-shaped, which is every *tagged* value — so a date column
 * pasted as `{"$":"date","data":"2012-04-24T00:00:00.000Z"}` and a bigint as
 * `{"$":"bigint","data":"9007199254740993"}`. The host's file writer had always
 * used `displayValue`; only the clipboard had its own idea, and being the one
 * path with no test is exactly how it stayed wrong.
 */
function asText(value: CellValue, dataType: string | undefined): string {
  return displayValue(value, dataType === undefined ? {} : { dataType });
}

/**
 * Whole fields rather than bare names: a column carries its declared type, and
 * that is what decides how an instant is written. A paste that disagrees with
 * what was on screen is the failure mode this file exists to avoid.
 */
export type Columns = readonly Field[];

/**
 * Tabs or commas. A field containing the delimiter, a quote or a newline is
 * quoted and its quotes doubled — the same rule for both, because a paste into
 * a spreadsheet fails the same way in either.
 */
export function toDelimited(
  columns: Columns,
  rows: readonly Record<string, CellValue>[],
  delimiter: ',' | '\t'
): string {
  return toDelimitedGrid(
    [
      columns.map((column) => column.name),
      ...rows.map((row) =>
        columns.map((column) => asText(row[column.name] ?? null, column.dataType))
      ),
    ],
    delimiter
  );
}

/**
 * A rectangle of already-rendered text, as delimited lines.
 *
 * This is what a range copy out of the grid needs: a selection is some columns
 * of some rows and carries no header, and the cells have already been through
 * `displayValue` on their way to the screen. Same escaping either way — a value
 * holding the delimiter, a quote or a newline is quoted and its quotes doubled,
 * because a paste into a spreadsheet breaks identically in both.
 */
export function toDelimitedGrid(
  rows: readonly (readonly string[])[],
  delimiter: ',' | '\t'
): string {
  const escape = (value: string) =>
    value.includes(delimiter) || value.includes('"') || value.includes('\n')
      ? `"${value.replace(/"/g, '""')}"`
      : value;

  return rows.map((row) => row.map(escape).join(delimiter)).join('\n');
}

/**
 * JSON keeps the value's own shape where it has one — a number stays a number,
 * null stays null — and unwraps a tag to its text rather than emitting the
 * transport envelope around it.
 */
export function toJson(columns: Columns, rows: readonly Record<string, CellValue>[]): string {
  return JSON.stringify(
    rows.map((row) =>
      Object.fromEntries(
        columns.map((column) => {
          const value = row[column.name] ?? null;
          return [column.name, isTagged(value) ? asText(value, column.dataType) : value];
        })
      )
    ),
    null,
    2
  );
}

/**
 * A GitHub-flavoured table. Pipes inside a value are escaped rather than
 * dropped, and every column is padded to its widest cell so the source is
 * readable even where it is never rendered.
 */
export function toMarkdown(
  columns: Columns,
  rows: readonly Record<string, CellValue>[]
): string {
  const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const body = rows.map((row) =>
    columns.map((column) => cell(asText(row[column.name] ?? null, column.dataType)))
  );
  const widths = columns.map((column, index) =>
    Math.max(column.name.length, ...body.map((row) => row[index]!.length), 3)
  );

  const line = (cells: readonly string[]) =>
    `| ${cells.map((value, index) => value.padEnd(widths[index]!)).join(' | ')} |`;

  return [
    line(columns.map((column) => cell(column.name))),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...body.map(line),
  ].join('\n');
}
