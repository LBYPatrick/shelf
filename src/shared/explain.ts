/**
 * Reading a query plan.
 *
 * Every engine reports EXPLAIN differently — Postgres emits JSON, MySQL emits
 * a tree or a table, SQLite emits an indented list. They are normalised into
 * one shape so the diagram does not need to know which database it is looking
 * at.
 */

export interface PlanNode {
  readonly label: string;
  readonly detail?: string;
  /** Estimated or actual cost, used to size the node. */
  readonly cost?: number;
  readonly rows?: number;
  /** Actual milliseconds, when the plan was produced by EXPLAIN ANALYZE. */
  readonly actualMs?: number;
  readonly children: readonly PlanNode[];
}

interface PostgresPlan {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Total Cost'?: number;
  'Plan Rows'?: number;
  'Actual Total Time'?: number;
  'Actual Rows'?: number;
  Plans?: PostgresPlan[];
}

/** Postgres, with `EXPLAIN (FORMAT JSON)`. */
function fromPostgres(plan: PostgresPlan): PlanNode {
  const relation = plan['Relation Name'] ?? plan['Index Name'];

  return {
    label: plan['Node Type'],
    ...(relation ? { detail: relation } : {}),
    ...(plan['Total Cost'] !== undefined ? { cost: plan['Total Cost'] } : {}),
    ...((plan['Actual Rows'] ?? plan['Plan Rows'])
      ? { rows: plan['Actual Rows'] ?? plan['Plan Rows'] }
      : {}),
    ...(plan['Actual Total Time'] !== undefined ? { actualMs: plan['Actual Total Time'] } : {}),
    children: (plan.Plans ?? []).map(fromPostgres),
  };
}

/**
 * SQLite's `EXPLAIN QUERY PLAN` is a flat list with parent ids, which has to be
 * reassembled into the tree it describes.
 */
function fromSqlite(rows: readonly Record<string, unknown>[]): PlanNode | undefined {
  if (rows.length === 0) return undefined;

  const nodes = new Map<number, PlanNode & { children: PlanNode[] }>();
  const roots: (PlanNode & { children: PlanNode[] })[] = [];

  for (const row of rows) {
    const id = Number(row['id'] ?? row['selectid'] ?? 0);
    const parent = Number(row['parent'] ?? 0);
    const detail = String(row['detail'] ?? '');

    // The first word or two is the operation; the rest is what it operates on.
    const match =
      /^(SCAN|SEARCH|USE TEMP B-TREE|CO-ROUTINE|MATERIALIZE|CORRELATED [\w ]+)\s*(.*)$/i.exec(
        detail
      );

    const node = {
      label: match?.[1] ?? detail.split(' ')[0] ?? 'STEP',
      ...(match?.[2] ? { detail: match[2] } : { detail }),
      children: [] as PlanNode[],
    };

    nodes.set(id, node);

    const parentNode = nodes.get(parent);
    if (parent && parentNode) parentNode.children.push(node);
    else roots.push(node);
  }

  if (roots.length === 1) return roots[0];
  return { label: 'QUERY PLAN', children: roots };
}

/** MySQL's `EXPLAIN FORMAT=JSON`. */
function fromMysql(value: Record<string, unknown>, label = 'query'): PlanNode {
  const children: PlanNode[] = [];
  let cost: number | undefined;
  let rows: number | undefined;
  let detail: string | undefined;

  for (const [key, child] of Object.entries(value)) {
    if (key === 'table_name' || key === 'access_type') detail = String(child);
    if (key === 'rows_examined_per_scan') rows = Number(child);
    if (key === 'query_cost' || key === 'prefix_cost') cost = Number(child);

    if (child && typeof child === 'object') {
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === 'object') {
            children.push(fromMysql(item as Record<string, unknown>, key));
          }
        }
      } else {
        children.push(fromMysql(child as Record<string, unknown>, key));
      }
    }
  }

  return {
    label,
    ...(detail ? { detail } : {}),
    ...(cost !== undefined ? { cost } : {}),
    ...(rows !== undefined ? { rows } : {}),
    children,
  };
}

/**
 * Turns whatever the engine returned into a plan tree, or undefined when the
 * result was not a plan at all.
 */
export function parsePlan(
  engine: string,
  rows: readonly Record<string, unknown>[]
): PlanNode | undefined {
  if (rows.length === 0) return undefined;

  const first = rows[0]!;

  // Postgres puts the whole plan in one JSON column.
  const jsonColumn = Object.values(first).find(
    (value) => typeof value === 'string' && value.trim().startsWith('[')
  );

  if (typeof jsonColumn === 'string') {
    try {
      const parsed = JSON.parse(jsonColumn) as { Plan?: PostgresPlan }[];
      const plan = parsed[0]?.Plan;
      if (plan) return fromPostgres(plan);
    } catch {
      // Not a plan we can read; fall through to the other shapes.
    }
  }

  if (engine === 'mysql' || engine === 'tidb') {
    const raw = Object.values(first).find(
      (value) => typeof value === 'string' && value.trim().startsWith('{')
    );
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return fromMysql(parsed);
      } catch {
        // Fall through.
      }
    }
  }

  if ('detail' in first || 'selectid' in first) return fromSqlite(rows);

  return undefined;
}

/** The statement that asks this engine for a plan. */
export function explainStatement(engine: string, sql: string): string {
  const text = sql.trim().replace(/;$/, '');

  switch (engine) {
    case 'postgres':
      return `EXPLAIN (FORMAT JSON) ${text}`;
    case 'mysql':
    case 'tidb':
      return `EXPLAIN FORMAT=JSON ${text}`;
    case 'sqlite':
    case 'duckdb':
      return `EXPLAIN QUERY PLAN ${text}`;
    default:
      return `EXPLAIN ${text}`;
  }
}

/** Flattens the tree so the largest cost can size the rest. */
export function maxCost(node: PlanNode): number {
  return Math.max(node.cost ?? 0, ...node.children.map(maxCost));
}
