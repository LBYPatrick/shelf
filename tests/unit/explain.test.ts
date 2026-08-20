import { describe, expect, it } from 'vitest';
import { explainStatement, maxCost, parsePlan } from '@shared/explain';

describe('explain statements', () => {
  it('asks each engine in its own dialect', () => {
    expect(explainStatement('postgres', 'SELECT 1')).toBe('EXPLAIN (FORMAT JSON) SELECT 1');
    expect(explainStatement('mysql', 'SELECT 1')).toBe('EXPLAIN FORMAT=JSON SELECT 1');
    expect(explainStatement('sqlite', 'SELECT 1')).toBe('EXPLAIN QUERY PLAN SELECT 1');
  });

  it('strips a trailing semicolon, which would otherwise end the statement early', () => {
    expect(explainStatement('postgres', 'SELECT 1;')).toBe('EXPLAIN (FORMAT JSON) SELECT 1');
  });
});

describe('parsing plans', () => {
  it('reads a Postgres JSON plan into a tree', () => {
    const rows = [
      {
        'QUERY PLAN': JSON.stringify([
          {
            Plan: {
              'Node Type': 'Hash Join',
              'Total Cost': 120.5,
              'Plan Rows': 400,
              Plans: [
                { 'Node Type': 'Seq Scan', 'Relation Name': 'album', 'Total Cost': 30 },
                {
                  'Node Type': 'Hash',
                  'Total Cost': 60,
                  Plans: [
                    { 'Node Type': 'Seq Scan', 'Relation Name': 'artist', 'Total Cost': 12 },
                  ],
                },
              ],
            },
          },
        ]),
      },
    ];

    const plan = parsePlan('postgres', rows)!;
    expect(plan.label).toBe('Hash Join');
    expect(plan.cost).toBe(120.5);
    expect(plan.children).toHaveLength(2);
    expect(plan.children[0]!.detail).toBe('album');
    expect(plan.children[1]!.children[0]!.detail).toBe('artist');
  });

  it('finds the largest cost anywhere in the tree', () => {
    const plan = parsePlan('postgres', [
      {
        p: JSON.stringify([
          {
            Plan: {
              'Node Type': 'A',
              'Total Cost': 10,
              Plans: [{ 'Node Type': 'B', 'Total Cost': 99 }],
            },
          },
        ]),
      },
    ])!;
    expect(maxCost(plan)).toBe(99);
  });

  it('reassembles SQLite’s flat list into the tree it describes', () => {
    const plan = parsePlan('sqlite', [
      { id: 2, parent: 0, detail: 'SCAN album' },
      { id: 3, parent: 2, detail: 'SEARCH artist USING INTEGER PRIMARY KEY (rowid=?)' },
    ])!;

    expect(plan.label).toBe('SCAN');
    expect(plan.detail).toBe('album');
    expect(plan.children).toHaveLength(1);
    expect(plan.children[0]!.label).toBe('SEARCH');
  });

  it('keeps several SQLite roots under one node', () => {
    const plan = parsePlan('sqlite', [
      { id: 1, parent: 0, detail: 'SCAN a' },
      { id: 2, parent: 0, detail: 'SCAN b' },
    ])!;
    expect(plan.label).toBe('QUERY PLAN');
    expect(plan.children).toHaveLength(2);
  });

  it('returns nothing when the result was not a plan', () => {
    expect(parsePlan('postgres', [])).toBeUndefined();
    expect(parsePlan('postgres', [{ id: 1, name: 'x' }])).toBeUndefined();
  });
});

describe('a plan column the driver already parsed', () => {
  /*
   * `EXPLAIN (FORMAT JSON)` returns a `json` column, and `pg` has a parser for
   * that type — so the plan arrives as a value, gets tagged as JSON by the
   * transcoder on its way across the boundary, and is not the string this used
   * to look for. Every Postgres plan reported itself as unreadable.
   */
  const plan = [
    {
      Plan: {
        'Node Type': 'Seq Scan',
        'Relation Name': 'album',
        'Total Cost': 12.5,
        'Plan Rows': 64,
      },
    },
  ];

  it('reads a plan that crossed the boundary as a tagged value', () => {
    const parsed = parsePlan('postgres', [
      { 'QUERY PLAN': { $: 'json', data: JSON.stringify(plan) } },
    ]);
    expect(parsed?.label).toContain('Seq Scan');
  });

  it('still reads one that arrived as text', () => {
    const parsed = parsePlan('postgres', [{ 'QUERY PLAN': JSON.stringify(plan) }]);
    expect(parsed?.label).toContain('Seq Scan');
  });

  it('reads a MySQL plan tagged the same way', () => {
    const mysql = { query_block: { select_id: 1, table: { table_name: 'album' } } };
    const parsed = parsePlan('mysql', [
      { EXPLAIN: { $: 'json', data: JSON.stringify(mysql) } },
    ]);
    expect(parsed).toBeDefined();
  });
});
