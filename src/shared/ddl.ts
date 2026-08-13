import type { EngineId, EntityRef } from '../drivers/types';

/**
 * Generating schema changes.
 *
 * Every change is produced as text first and shown to the user before anything
 * runs. Schema edits are the operations people are most right to be nervous
 * about, and a preview turns "I hope this does what I meant" into "I can see
 * what this does".
 */

export type SchemaChange =
  | {
      kind: 'add-column';
      entity: EntityRef;
      name: string;
      dataType: string;
      nullable: boolean;
      defaultValue?: string;
    }
  | { kind: 'drop-column'; entity: EntityRef; name: string }
  | { kind: 'rename-column'; entity: EntityRef; from: string; to: string }
  | {
      kind: 'add-index';
      entity: EntityRef;
      name: string;
      columns: readonly string[];
      unique: boolean;
    }
  | { kind: 'drop-index'; entity: EntityRef; name: string }
  | { kind: 'rename-entity'; entity: EntityRef; to: string }
  | { kind: 'drop-entity'; entity: EntityRef }
  | { kind: 'truncate-entity'; entity: EntityRef };

const QUOTES: Record<string, string> = {
  mysql: '`',
  tidb: '`',
};

function quote(name: string, engine: EngineId): string {
  const q = QUOTES[engine] ?? '"';
  return `${q}${name.split(q).join(q + q)}${q}`;
}

function qualify(entity: EntityRef, engine: EngineId): string {
  const name = quote(entity.name, engine);
  return entity.schema ? `${quote(entity.schema, engine)}.${name}` : name;
}

/** True when this engine can perform the change at all. */
export function isSupported(change: SchemaChange, engine: EngineId): boolean {
  // SQLite cannot drop or rename a column on older files without rewriting the
  // table, and cannot alter a column's type at all. Saying so beats emitting a
  // statement the engine will reject.
  if (engine === 'sqlite' && change.kind === 'drop-column') return false;
  if (engine === 'duckdb' && change.kind === 'rename-column') return true;
  return true;
}

export function buildDdl(change: SchemaChange, engine: EngineId): string {
  const table = qualify(change.entity, engine);

  switch (change.kind) {
    case 'add-column': {
      const parts = [
        `ALTER TABLE ${table} ADD COLUMN ${quote(change.name, engine)} ${change.dataType}`,
      ];
      if (!change.nullable) parts.push('NOT NULL');
      if (change.defaultValue) parts.push(`DEFAULT ${change.defaultValue}`);
      return `${parts.join(' ')};`;
    }

    case 'drop-column':
      return `ALTER TABLE ${table} DROP COLUMN ${quote(change.name, engine)};`;

    case 'rename-column':
      return (
        `ALTER TABLE ${table} RENAME COLUMN ` +
        `${quote(change.from, engine)} TO ${quote(change.to, engine)};`
      );

    case 'add-index': {
      const columns = change.columns.map((column) => quote(column, engine)).join(', ');
      return (
        `CREATE ${change.unique ? 'UNIQUE ' : ''}INDEX ${quote(change.name, engine)} ` +
        `ON ${table} (${columns});`
      );
    }

    case 'drop-index':
      // MySQL hangs its indexes off the table; everyone else drops them by name.
      return engine === 'mysql' || engine === 'tidb'
        ? `ALTER TABLE ${table} DROP INDEX ${quote(change.name, engine)};`
        : `DROP INDEX ${quote(change.name, engine)};`;

    case 'rename-entity':
      return `ALTER TABLE ${table} RENAME TO ${quote(change.to, engine)};`;

    case 'drop-entity':
      return `DROP TABLE ${table};`;

    case 'truncate-entity':
      // SQLite has no TRUNCATE; an unqualified DELETE is its equivalent.
      return engine === 'sqlite' ? `DELETE FROM ${table};` : `TRUNCATE TABLE ${table};`;
  }
}

/** A short, plain description of what the change will do, for the confirmation. */
export function describe(change: SchemaChange): string {
  switch (change.kind) {
    case 'add-column':
      return `Add the column ${change.name} to ${change.entity.name}.`;
    case 'drop-column':
      return `Delete the column ${change.name} and everything in it. This cannot be undone.`;
    case 'rename-column':
      return `Rename ${change.from} to ${change.to}.`;
    case 'add-index':
      return `Index ${change.entity.name} on ${change.columns.join(', ')}.`;
    case 'drop-index':
      return `Remove the index ${change.name}.`;
    case 'rename-entity':
      return `Rename ${change.entity.name} to ${change.to}.`;
    case 'drop-entity':
      return `Delete ${change.entity.name} and every row in it. This cannot be undone.`;
    case 'truncate-entity':
      return `Delete every row in ${change.entity.name}, keeping the table. This cannot be undone.`;
  }
}

/** True when the change destroys data, so the confirmation must be explicit. */
export function isDestructive(change: SchemaChange): boolean {
  return ['drop-column', 'drop-entity', 'truncate-entity'].includes(change.kind);
}
