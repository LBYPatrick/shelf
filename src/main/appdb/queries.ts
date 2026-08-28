import { randomUUID } from 'node:crypto';
import type { AppDatabase } from './database';

/**
 * Query history and saved queries.
 *
 * History is capped: a client that keeps every statement anyone ever ran turns
 * into a slow, unsearchable log. Trimming on write keeps the table small enough
 * that the recent list stays instant.
 */

const HISTORY_LIMIT = 2000;

export interface HistoryEntry {
  readonly id: string;
  readonly connectionId: string | null;
  readonly text: string;
  readonly rowCount: number | null;
  readonly durationMs: number | null;
  readonly succeeded: boolean;
  readonly executedAt: number;
}

export interface SavedQuery {
  readonly id: string;
  readonly name: string;
  readonly text: string;
  readonly connectionId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface HistoryRow {
  id: string;
  connection_id: string | null;
  text: string;
  row_count: number | null;
  duration_ms: number | null;
  succeeded: number;
  executed_at: number;
}

interface SavedRow {
  id: string;
  name: string;
  text: string;
  connection_id: string | null;
  created_at: number;
  updated_at: number;
}

export class QueryRepository {
  constructor(private readonly db: AppDatabase) {}

  /**
   * The connection id to file a row under, which is `null` unless it is real.
   *
   * `connection_id` is a foreign key and not every open connection is a row in
   * that table: sample mode has none at all, and a connection opened from a URL
   * without being saved has none either. Writing the open connection's id
   * regardless throws `FOREIGN KEY constraint failed` — inside a promise nobody
   * awaits, so the write silently does not happen and the only sign of it is a
   * line in the console.
   *
   * The column is nullable and every reader already handles null, which is the
   * honest place for a row whose connection the app does not have on file.
   *
   * A method rather than four lines repeated, because it *was* four lines
   * repeated in one place and absent in the other: the history had this and
   * saving a query did not, so saving one in sample mode failed exactly the
   * same way, months apart, for exactly the same reason.
   */
  private onFile(connectionId: string | null): string | null {
    if (connectionId === null) return null;

    const row = this.db.prepare('SELECT 1 FROM connection WHERE id = ?').get(connectionId);
    return row === undefined ? null : connectionId;
  }

  record(entry: Omit<HistoryEntry, 'id' | 'executedAt'>): void {
    const text = entry.text.trim();
    if (!text) return;

    const connectionId = this.onFile(entry.connectionId);

    // A statement re-run within a few seconds is the same act, not two: keeping
    // both would fill the list with near-duplicates of whatever is being
    // iterated on right now.
    const recent = this.db
      .prepare(
        'SELECT id, executed_at FROM query_history WHERE connection_id IS ? AND text = ? ORDER BY executed_at DESC LIMIT 1'
      )
      .get(connectionId, text) as { id: string; executed_at: number } | undefined;

    const now = Date.now();

    if (recent && now - recent.executed_at < 10_000) {
      this.db
        .prepare(
          'UPDATE query_history SET executed_at = ?, row_count = ?, duration_ms = ?, succeeded = ? WHERE id = ?'
        )
        .run(now, entry.rowCount, entry.durationMs, entry.succeeded ? 1 : 0, recent.id);
      return;
    }

    this.db
      .prepare(
        `INSERT INTO query_history (id, connection_id, text, row_count, duration_ms, succeeded, executed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        connectionId,
        text,
        entry.rowCount,
        entry.durationMs,
        entry.succeeded ? 1 : 0,
        now
      );

    this.db
      .prepare(
        `DELETE FROM query_history WHERE id NOT IN (
           SELECT id FROM query_history ORDER BY executed_at DESC LIMIT ?
         )`
      )
      .run(HISTORY_LIMIT);
  }

  history(connectionId: string | null, limit = 200): HistoryEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM query_history
          WHERE (? IS NULL OR connection_id = ?)
          ORDER BY executed_at DESC LIMIT ?`
      )
      .all(connectionId, connectionId, limit) as HistoryRow[];

    return rows.map((row) => ({
      id: row.id,
      connectionId: row.connection_id,
      text: row.text,
      rowCount: row.row_count,
      durationMs: row.duration_ms,
      succeeded: row.succeeded === 1,
      executedAt: row.executed_at,
    }));
  }

  clearHistory(connectionId: string | null): void {
    if (connectionId) {
      this.db.prepare('DELETE FROM query_history WHERE connection_id = ?').run(connectionId);
    } else {
      this.db.prepare('DELETE FROM query_history').run();
    }
  }

  listSaved(connectionId: string | null): SavedQuery[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM saved_query
          WHERE connection_id IS NULL OR (? IS NOT NULL AND connection_id = ?)
          ORDER BY updated_at DESC`
      )
      .all(connectionId, connectionId) as SavedRow[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      text: row.text,
      connectionId: row.connection_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  saveQuery(input: {
    id?: string;
    name: string;
    text: string;
    connectionId: string | null;
  }): SavedQuery {
    const id = input.id ?? randomUUID();
    const now = Date.now();

    const existing = this.db
      .prepare('SELECT created_at FROM saved_query WHERE id = ?')
      .get(id) as { created_at: number } | undefined;

    this.db
      .prepare(
        `INSERT INTO saved_query (id, name, text, connection_id, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, text = excluded.text, updated_at = excluded.updated_at`
      )
      .run(
        id,
        input.name,
        input.text,
        this.onFile(input.connectionId),
        existing?.created_at ?? now,
        now
      );

    // Every save is a version, so a query that was working an hour ago can be
    // recovered after it stops working.
    this.db
      .prepare(
        'INSERT INTO saved_query_version (id, saved_query_id, text, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(randomUUID(), id, input.text, now);

    return {
      id,
      name: input.name,
      text: input.text,
      connectionId: input.connectionId,
      createdAt: existing?.created_at ?? now,
      updatedAt: now,
    };
  }

  removeSaved(id: string): void {
    this.db.prepare('DELETE FROM saved_query WHERE id = ?').run(id);
  }
}
