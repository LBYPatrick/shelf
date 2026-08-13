import type { CellValue, ChangeSet } from '../types';
import { qualify, quoteIdentifier, type Dialect } from './dialect';

/**
 * Turning a set of grid edits into statements.
 *
 * Two forms are produced from the same description: parameterised statements
 * for execution, and fully-rendered text for the preview the user sees before
 * anything is committed. They are generated together so the preview cannot
 * drift from what actually runs.
 */

export interface PreparedStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/** Unwraps a value that was tagged for transport back into something bindable. */
export function untag(value: CellValue): unknown {
  if (value === null || typeof value !== 'object') return value;

  switch (value.$) {
    case 'binary':
      return Buffer.from(value.data, 'base64');
    case 'bigint':
      return value.data;
    case 'date':
      return new Date(value.data);
    default:
      return value.data;
  }
}

export function buildChangeStatements(
  changes: ChangeSet,
  dialect: Dialect
): PreparedStatement[] {
  const statements: PreparedStatement[] = [];

  for (const insert of changes.inserts) {
    const columns = Object.keys(insert.values);
    if (columns.length === 0) continue;

    const params: unknown[] = [];
    const placeholders = columns.map((column) => {
      params.push(untag(insert.values[column] ?? null));
      return dialect.placeholder(params.length);
    });

    statements.push({
      sql:
        `INSERT INTO ${qualify(insert.entity, dialect)} ` +
        `(${columns.map((c) => quoteIdentifier(c, dialect)).join(', ')}) ` +
        `VALUES (${placeholders.join(', ')})`,
      params,
    });
  }

  for (const update of changes.updates) {
    if (update.primaryKeys.length === 0) {
      // Matching on values instead could update several rows that happen to
      // look alike, which is not what editing one cell means.
      throw new Error(
        `Cannot update ${update.entity.name}.${update.column}: the row has no primary key.`
      );
    }

    const params: unknown[] = [untag(update.value)];
    const set = `${quoteIdentifier(update.column, dialect)} = ${dialect.placeholder(1)}`;

    const where = update.primaryKeys
      .map((key) => {
        params.push(untag(key.value));
        return `${quoteIdentifier(key.column, dialect)} = ${dialect.placeholder(params.length)}`;
      })
      .join(' AND ');

    statements.push({
      sql: `UPDATE ${qualify(update.entity, dialect)} SET ${set} WHERE ${where}`,
      params,
    });
  }

  for (const remove of changes.deletes) {
    if (remove.primaryKeys.length === 0) {
      throw new Error(`Cannot delete from ${remove.entity.name}: the row has no primary key.`);
    }

    const params: unknown[] = [];
    const where = remove.primaryKeys
      .map((key) => {
        params.push(untag(key.value));
        return `${quoteIdentifier(key.column, dialect)} = ${dialect.placeholder(params.length)}`;
      })
      .join(' AND ');

    statements.push({
      sql: `DELETE FROM ${qualify(remove.entity, dialect)} WHERE ${where}`,
      params,
    });
  }

  return statements;
}

/**
 * Renders a value as SQL text. **Preview only** — execution always binds
 * parameters, so this never becomes an injection path.
 */
export function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
  return `'${String(value).split("'").join("''")}'`;
}

/** The same changes, rendered as readable SQL for the preview. */
export function buildChangePreview(changes: ChangeSet, dialect: Dialect): string {
  return buildChangeStatements(changes, dialect)
    .map(({ sql, params }) => {
      // Substitute from the end so $10 is not partly replaced by $1's value.
      let rendered = sql;
      for (let index = params.length; index >= 1; index -= 1) {
        rendered = rendered.split(dialect.placeholder(index)).join(literal(params[index - 1]));
      }
      return `${rendered};`;
    })
    .join('\n');
}
