import type { Capabilities, EngineNouns } from './types';

/**
 * Capability defaults.
 *
 * Every driver starts from the relational baseline and declares its exceptions,
 * which keeps each driver's capability block short enough to read and check
 * against reality.
 */

export const RELATIONAL_NOUNS: EngineNouns = {
  database: 'database',
  entity: 'table',
  row: 'row',
  column: 'column',
};

export const SQL_BASELINE: Capabilities = {
  sql: true,
  queryLanguage: 'sql',
  schemas: true,
  multipleDatabases: true,
  transactions: true,
  indexes: true,
  relations: true,
  triggers: true,
  partitions: false,
  views: true,
  routines: true,
  comments: true,
  ddl: true,
  sortPushdown: 'full',
  filterPushdown: 'full',
  cheapCount: false,
  streaming: true,
  sshTunnel: true,
  nativeShell: false,
  nouns: RELATIONAL_NOUNS,
};

export function capabilities(overrides: Partial<Capabilities>): Capabilities {
  return { ...SQL_BASELINE, ...overrides };
}
