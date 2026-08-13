/**
 * Forward-only schema migrations for the application's own database.
 *
 * Deliberately hand-written SQL rather than an ORM: this database has a dozen
 * tables that change rarely, and an ORM's cost here is a large dependency plus
 * a layer of indirection between what is written and what actually runs.
 *
 * Never edit a migration that has shipped — add another one.
 */
export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: 'initial',
    sql: `
      CREATE TABLE connection_folder (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        parent_id    TEXT REFERENCES connection_folder(id) ON DELETE CASCADE,
        position     REAL NOT NULL DEFAULT 0,
        created_at   INTEGER NOT NULL
      );

      CREATE TABLE connection (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        engine         TEXT NOT NULL,
        folder_id      TEXT REFERENCES connection_folder(id) ON DELETE SET NULL,
        position       REAL NOT NULL DEFAULT 0,
        label_color    TEXT,
        pinned         INTEGER NOT NULL DEFAULT 0,
        read_only      INTEGER NOT NULL DEFAULT 0,
        -- Everything that is not a secret, as JSON. Secrets live in the OS
        -- keychain and are referenced by this row's id.
        config         TEXT NOT NULL,
        remember_secrets INTEGER NOT NULL DEFAULT 1,
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL,
        last_used_at   INTEGER
      );

      CREATE INDEX connection_folder_idx ON connection(folder_id);
      CREATE INDEX connection_last_used_idx ON connection(last_used_at DESC);

      CREATE TABLE tab (
        id             TEXT PRIMARY KEY,
        connection_id  TEXT NOT NULL REFERENCES connection(id) ON DELETE CASCADE,
        kind           TEXT NOT NULL,
        title          TEXT NOT NULL,
        subtitle       TEXT,
        position       REAL NOT NULL,
        active         INTEGER NOT NULL DEFAULT 0,
        -- Tab-kind-specific state: entity ref, filters, editor text, scroll.
        state          TEXT NOT NULL DEFAULT '{}',
        unsaved        INTEGER NOT NULL DEFAULT 0,
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL,
        -- Soft delete, so "reopen last closed tab" can bring it back intact.
        closed_at      INTEGER
      );

      CREATE INDEX tab_connection_idx ON tab(connection_id, closed_at);

      CREATE TABLE query_history (
        id             TEXT PRIMARY KEY,
        connection_id  TEXT REFERENCES connection(id) ON DELETE CASCADE,
        text           TEXT NOT NULL,
        row_count      INTEGER,
        duration_ms    INTEGER,
        succeeded      INTEGER NOT NULL DEFAULT 1,
        executed_at    INTEGER NOT NULL
      );

      CREATE INDEX query_history_recent_idx ON query_history(executed_at DESC);

      CREATE TABLE saved_query_folder (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        parent_id    TEXT REFERENCES saved_query_folder(id) ON DELETE CASCADE,
        position     REAL NOT NULL DEFAULT 0
      );

      CREATE TABLE saved_query (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        text           TEXT NOT NULL,
        folder_id      TEXT REFERENCES saved_query_folder(id) ON DELETE SET NULL,
        connection_id  TEXT REFERENCES connection(id) ON DELETE SET NULL,
        position       REAL NOT NULL DEFAULT 0,
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL
      );

      CREATE TABLE saved_query_version (
        id             TEXT PRIMARY KEY,
        saved_query_id TEXT NOT NULL REFERENCES saved_query(id) ON DELETE CASCADE,
        text           TEXT NOT NULL,
        created_at     INTEGER NOT NULL
      );

      CREATE INDEX saved_query_version_idx ON saved_query_version(saved_query_id, created_at DESC);

      CREATE TABLE setting (
        key    TEXT PRIMARY KEY,
        value  TEXT NOT NULL
      );

      -- Per-table grid layout: column widths, order and visibility.
      CREATE TABLE grid_layout (
        connection_id  TEXT NOT NULL REFERENCES connection(id) ON DELETE CASCADE,
        entity_key     TEXT NOT NULL,
        layout         TEXT NOT NULL,
        PRIMARY KEY (connection_id, entity_key)
      );
    `,
  },
];
