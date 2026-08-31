import type { EngineId } from '../drivers/types';

/**
 * The words an engine understands, offered by the editor's completer.
 *
 * Schema names alone were what the completer knew, which meant the one thing
 * every statement starts with — `SELECT` — had to be typed in full while the
 * table after it completed from three letters. The list is short on purpose:
 * these are the words that carry the *shape* of a statement, the handful of
 * functions people reach for without looking up, and the engine's own type
 * names. Every reserved word in every dialect is thousands long, disagrees
 * between engines, and buries the fifteen that matter.
 *
 * Differences are declared here rather than guessed at the call site — the same
 * rule the drivers follow. `AUTO_INCREMENT` is not a Postgres word and
 * `jsonb` is not a MySQL one, and offering either in the wrong editor teaches
 * the reader something untrue about the server they are connected to.
 */

export type SqlWordKind = 'keyword' | 'function' | 'type';

export interface SqlWord {
  readonly text: string;
  readonly kind: SqlWordKind;
}

/**
 * Comma separated rather than whitespace separated, because several of these
 * are two words — `GROUP BY` completes as a unit or it is not worth offering.
 */
function words(kind: SqlWordKind, list: string): SqlWord[] {
  return list
    .split(',')
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ text, kind }));
}

/**
 * Upper case for keywords and functions, because that is what the Format button
 * produces (`keywordCase: 'upper'`) — a completer that inserts `select` into a
 * file the formatter will rewrite as `SELECT` is a second opinion, not a help.
 * Types keep each engine's own spelling: Postgres writes `jsonb`, SQLite writes
 * `INTEGER`, and neither is a house style to be normalised away.
 */
const CORE_KEYWORDS = words(
  'keyword',
  `SELECT, FROM, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT, OFFSET, DISTINCT, AS,
   JOIN, INNER JOIN, LEFT JOIN, RIGHT JOIN, FULL OUTER JOIN, CROSS JOIN, ON, USING,
   AND, OR, NOT, IN, IS NULL, IS NOT NULL, LIKE, BETWEEN, EXISTS, ANY, ALL,
   CASE, WHEN, THEN, ELSE, END, ASC, DESC, NULLS FIRST, NULLS LAST,
   UNION, UNION ALL, INTERSECT, EXCEPT, WITH, WITH RECURSIVE,
   INSERT INTO, VALUES, UPDATE, SET, DELETE FROM, TRUNCATE,
   CREATE TABLE, CREATE VIEW, CREATE INDEX, CREATE UNIQUE INDEX,
   ALTER TABLE, DROP TABLE, DROP VIEW, DROP INDEX,
   ADD COLUMN, DROP COLUMN, RENAME TO, IF EXISTS, IF NOT EXISTS,
   PRIMARY KEY, FOREIGN KEY, REFERENCES, UNIQUE, CHECK, DEFAULT, NOT NULL,
   ON DELETE CASCADE, ON UPDATE CASCADE,
   BEGIN, COMMIT, ROLLBACK, EXPLAIN,
   OVER, PARTITION BY, ROWS BETWEEN, UNBOUNDED PRECEDING, CURRENT ROW`
);

const CORE_FUNCTIONS = words(
  'function',
  `COUNT, SUM, AVG, MIN, MAX, ROUND, ABS, CEIL, FLOOR, LENGTH, LOWER, UPPER, TRIM,
   SUBSTRING, REPLACE, CAST, COALESCE, NULLIF, CURRENT_DATE, CURRENT_TIMESTAMP,
   ROW_NUMBER, RANK, DENSE_RANK, LAG, LEAD`
);

/** The words Postgres has that ANSI does not, plus the types it names its own way. */
const POSTGRES = [
  ...words(
    'keyword',
    `ILIKE, RETURNING, ON CONFLICT, DO NOTHING, DO UPDATE SET, LATERAL, TABLESAMPLE,
     MATERIALIZED, GENERATED ALWAYS AS IDENTITY, SIMILAR TO, DISTINCT ON,
     FOR UPDATE, VACUUM, ANALYZE, COPY, CREATE SCHEMA, CREATE EXTENSION`
  ),
  ...words(
    'function',
    `NOW, ARRAY_AGG, STRING_AGG, JSONB_AGG, JSONB_BUILD_OBJECT, JSON_AGG,
     GENERATE_SERIES, DATE_TRUNC, EXTRACT, TO_CHAR, TO_TIMESTAMP, AGE,
     GEN_RANDOM_UUID, REGEXP_REPLACE, SPLIT_PART, UNNEST`
  ),
  ...words(
    'type',
    `smallint, integer, bigint, serial, bigserial, numeric, real, double precision,
     text, varchar, char, boolean, date, time, timestamp, timestamptz, interval,
     uuid, json, jsonb, bytea, inet, cidr, macaddr, money, tsvector`
  ),
];

/** MySQL and TiDB speak the same dialect; TiDB reports itself as its own engine. */
const MYSQL = [
  ...words(
    'keyword',
    `REPLACE INTO, ON DUPLICATE KEY UPDATE, INSERT IGNORE, STRAIGHT_JOIN,
     AUTO_INCREMENT, ENGINE, CHARACTER SET, COLLATE, UNSIGNED, ZEROFILL,
     SHOW TABLES, SHOW COLUMNS FROM, SHOW CREATE TABLE, DESCRIBE, USE,
     FORCE INDEX, USE INDEX, LOCK IN SHARE MODE`
  ),
  ...words(
    'function',
    `NOW, IFNULL, IF, GROUP_CONCAT, JSON_EXTRACT, JSON_UNQUOTE, DATE_FORMAT,
     DATE_ADD, DATE_SUB, DATEDIFF, CONCAT, CONCAT_WS, SUBSTRING_INDEX,
     UNIX_TIMESTAMP, FROM_UNIXTIME, UUID, LAST_INSERT_ID`
  ),
  ...words(
    'type',
    `TINYINT, SMALLINT, MEDIUMINT, INT, BIGINT, DECIMAL, FLOAT, DOUBLE, BIT,
     CHAR, VARCHAR, TINYTEXT, TEXT, MEDIUMTEXT, LONGTEXT, BLOB, LONGBLOB,
     DATE, DATETIME, TIMESTAMP, TIME, YEAR, JSON, ENUM, SET, BOOLEAN`
  ),
];

const SQLITE = [
  ...words(
    'keyword',
    `AUTOINCREMENT, PRAGMA, WITHOUT ROWID, ON CONFLICT, DO NOTHING, DO UPDATE SET,
     RETURNING, GLOB, REGEXP, VACUUM, ATTACH DATABASE, DETACH DATABASE,
     INSERT OR REPLACE INTO, INSERT OR IGNORE INTO, COLLATE NOCASE`
  ),
  ...words(
    'function',
    `IFNULL, GROUP_CONCAT, JSON_EXTRACT, JSON_GROUP_ARRAY, STRFTIME, DATE, TIME,
     DATETIME, JULIANDAY, SUBSTR, INSTR, PRINTF, RANDOM, TYPEOF, HEX`
  ),
  ...words('type', `INTEGER, REAL, TEXT, BLOB, NUMERIC`),
];

const DUCKDB = [
  ...words(
    'keyword',
    `QUALIFY, PIVOT, UNPIVOT, EXCLUDE, REPLACE, USING SAMPLE, ASOF JOIN,
     POSITIONAL JOIN, SUMMARIZE, DESCRIBE, COPY, INSTALL, LOAD, ATTACH,
     ON CONFLICT, DO NOTHING, DO UPDATE SET, RETURNING, GROUP BY ALL, ORDER BY ALL`
  ),
  ...words(
    'function',
    `READ_CSV, READ_CSV_AUTO, READ_PARQUET, READ_JSON_AUTO, LIST_AGGREGATE,
     LIST_VALUE, UNNEST, STRFTIME, STRPTIME, DATE_TRUNC, EPOCH_MS, REGEXP_MATCHES,
     STRING_SPLIT, ARRAY_AGG, STRING_AGG, GENERATE_SERIES`
  ),
  ...words(
    'type',
    `BOOLEAN, TINYINT, SMALLINT, INTEGER, BIGINT, HUGEINT, UBIGINT, DECIMAL,
     REAL, DOUBLE, VARCHAR, BLOB, DATE, TIME, TIMESTAMP, TIMESTAMPTZ, INTERVAL,
     UUID, JSON, LIST, STRUCT, MAP, ENUM`
  ),
];

/**
 * CQL, which is not SQL wearing a different hat.
 *
 * It has no joins, no subqueries and no `OFFSET`, so offering the core list
 * here would fill the editor with words the server rejects. Scylla gets its own
 * set rather than the shared one plus corrections.
 */
const CQL = [
  ...words(
    'keyword',
    `SELECT, FROM, WHERE, LIMIT, ORDER BY, ASC, DESC, ALLOW FILTERING, AND, IN,
     CONTAINS, CONTAINS KEY, TOKEN, IF NOT EXISTS, IF EXISTS,
     INSERT INTO, VALUES, USING TTL, USING TIMESTAMP, UPDATE, SET, DELETE FROM,
     BEGIN BATCH, APPLY BATCH, TRUNCATE,
     CREATE KEYSPACE, CREATE TABLE, CREATE INDEX, CREATE TYPE,
     ALTER TABLE, DROP TABLE, DROP KEYSPACE, PRIMARY KEY, CLUSTERING ORDER BY,
     WITH REPLICATION, COMPACT STORAGE, STATIC, FROZEN`
  ),
  ...words('function', `COUNT, MIN, MAX, SUM, AVG, TTL, WRITETIME, NOW, UUID, TOUNIXTIMESTAMP`),
  ...words(
    'type',
    `ascii, bigint, blob, boolean, counter, date, decimal, double, duration, float,
     inet, int, smallint, text, time, timestamp, timeuuid, tinyint, uuid, varchar,
     varint, list, set, map, tuple`
  ),
];

const SQL_CORE = [...CORE_KEYWORDS, ...CORE_FUNCTIONS];

/**
 * One entry per word, with the engine's own account winning.
 *
 * The lists overlap on purpose — DuckDB's `REPLACE` is a clause where the core
 * list has it as a function — and a completer showing the same word twice with
 * two different icons is asking the reader to pick between them.
 */
function merge(...lists: readonly SqlWord[][]): readonly SqlWord[] {
  const byText = new Map<string, SqlWord>();
  for (const list of lists) {
    for (const word of list) byText.set(word.text, word);
  }
  return [...byText.values()];
}

/**
 * What to offer for an engine, or nothing at all for one that does not speak
 * SQL. Redis, MongoDB and DynamoDB are queried through their own languages, and
 * a `SELECT` in any of those editors is a word that cannot be run.
 */
export function sqlWords(engine: EngineId | undefined): readonly SqlWord[] {
  switch (engine) {
    case 'postgres':
      return merge(SQL_CORE, POSTGRES);
    case 'mysql':
    case 'tidb':
      return merge(SQL_CORE, MYSQL);
    case 'sqlite':
    case 'mock':
      return merge(SQL_CORE, SQLITE);
    case 'duckdb':
      return merge(SQL_CORE, DUCKDB);
    case 'scylla':
      return merge(CQL);
    default:
      return [];
  }
}
