import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { app } from 'electron';
import { MIGRATIONS } from './migrations';

export type AppDatabase = Database.Database;

let instance: AppDatabase | null = null;

/**
 * Opens the application database, creating and migrating it if needed.
 *
 * WAL is on because the interface reads settings and tabs constantly while
 * writing them occasionally, and the default journal makes those block each
 * other. Foreign keys are on because SQLite otherwise ignores the constraints
 * the schema declares, which turns a cascade delete into orphaned rows.
 */
export function openAppDatabase(path?: string): AppDatabase {
  if (instance) return instance;

  const file = path ?? join(app.getPath('userData'), 'shelf.db');
  mkdirSync(dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  migrate(db);

  instance = db;
  return db;
}

export function migrate(db: AppDatabase): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS migration (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)'
  );

  const applied = new Set(
    db
      .prepare('SELECT id FROM migration')
      .all()
      .map((row) => (row as { id: number }).id)
  );

  const record = db.prepare('INSERT INTO migration (id, name, applied_at) VALUES (?, ?, ?)');

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;

    // Each migration is one transaction: a half-applied schema change is far
    // worse than a failed upgrade we can retry.
    const run = db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.id, migration.name, Date.now());
    });

    run();
  }
}

export function closeAppDatabase(): void {
  instance?.close();
  instance = null;
}
