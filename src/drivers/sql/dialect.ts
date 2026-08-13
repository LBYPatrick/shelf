import type { ColumnFilter, Filters, OrderBy } from '../types';

/**
 * SQL text generation shared by the relational drivers.
 *
 * Every value the user supplies becomes a bound parameter, never string
 * interpolation. Identifiers cannot be parameterised, so they are quoted with
 * the engine's own quoting rules and the quote character inside a name is
 * doubled — which is what stops a table called `it"s` from ending the literal.
 */

export interface Dialect {
  /** The character that wraps identifiers: `"` for Postgres, `` ` `` for MySQL. */
  readonly quote: string;
  /** Renders the nth bind placeholder. Postgres numbers them; MySQL does not. */
  placeholder(index: number): string;
  /** Renders LIMIT/OFFSET, which is not universal. */
  limitClause(limit: number, offset: number): string;
}

export const ANSI_DIALECT: Dialect = {
  quote: '"',
  placeholder: () => '?',
  limitClause: (limit, offset) => `LIMIT ${limit} OFFSET ${offset}`,
};

export function quoteIdentifier(name: string, dialect: Dialect): string {
  const q = dialect.quote;
  return `${q}${name.split(q).join(q + q)}${q}`;
}

/** Qualifies an entity, including its schema when the engine uses them. */
export function qualify(entity: { name: string; schema?: string }, dialect: Dialect): string {
  const name = quoteIdentifier(entity.name, dialect);
  return entity.schema ? `${quoteIdentifier(entity.schema, dialect)}.${name}` : name;
}

export interface WhereClause {
  /** Includes the leading `WHERE`, or is empty when there is nothing to filter. */
  readonly sql: string;
  readonly params: readonly unknown[];
}

const OPERATORS_WITHOUT_VALUE = new Set(['is null', 'is not null']);
const OPERATORS_WITH_LIST = new Set(['in', 'not in']);

function renderFilter(filter: ColumnFilter, dialect: Dialect, params: unknown[]): string {
  const column = quoteIdentifier(filter.column, dialect);

  if (OPERATORS_WITHOUT_VALUE.has(filter.operator)) {
    return `${column} ${filter.operator.toUpperCase()}`;
  }

  if (OPERATORS_WITH_LIST.has(filter.operator)) {
    // An empty IN list is a syntax error in most engines, and semantically the
    // filter matches nothing, so say that directly.
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    if (values.length === 0) return filter.operator === 'in' ? '1 = 0' : '1 = 1';

    const placeholders = values
      .map((value) => {
        params.push(value);
        return dialect.placeholder(params.length);
      })
      .join(', ');

    return `${column} ${filter.operator.toUpperCase()} (${placeholders})`;
  }

  params.push(filter.value);
  return `${column} ${filter.operator.toUpperCase()} ${dialect.placeholder(params.length)}`;
}

export function buildWhere(filters: Filters | undefined, dialect: Dialect): WhereClause {
  if (!filters) return { sql: '', params: [] };

  if (filters.kind === 'raw') {
    const expression = filters.expression.trim();
    // Raw mode is the user writing SQL against their own database, which they
    // could equally do in the query tab; it is passed through as typed.
    return expression ? { sql: ` WHERE ${expression}`, params: [] } : { sql: '', params: [] };
  }

  if (filters.filters.length === 0) return { sql: '', params: [] };

  const params: unknown[] = [];
  const parts = filters.filters.map((filter, index) => {
    const rendered = renderFilter(filter, dialect, params);
    if (index === 0) return rendered;
    return `${(filter.join ?? 'and').toUpperCase()} ${rendered}`;
  });

  return { sql: ` WHERE ${parts.join(' ')}`, params };
}

export function buildOrderBy(
  orderBy: readonly OrderBy[] | undefined,
  dialect: Dialect
): string {
  if (!orderBy || orderBy.length === 0) return '';
  const parts = orderBy.map(
    (order) =>
      `${quoteIdentifier(order.column, dialect)} ${order.direction === 'desc' ? 'DESC' : 'ASC'}`
  );
  return ` ORDER BY ${parts.join(', ')}`;
}

export function buildSelectList(
  select: readonly string[] | undefined,
  dialect: Dialect
): string {
  if (!select || select.length === 0) return '*';
  return select.map((column) => quoteIdentifier(column, dialect)).join(', ');
}
