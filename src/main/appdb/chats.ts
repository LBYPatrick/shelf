import { randomUUID } from 'node:crypto';
import type { SavedChat, SaveChatInput } from '@shared/appdb';
import type { AppDatabase } from './database';

/**
 * Conversations, kept.
 *
 * They were deliberately not kept at first, on the argument that a transcript
 * holds whatever rows the assistant read on the way to an answer, and that
 * filing those beside the connection list is a promise about someone's data
 * this feature had not earned. That argument loses to the obvious: a chat you
 * cannot get back is a chat you have to have again, and the app already keeps
 * every statement anyone runs in `history`.
 *
 * So they are kept, per connection, and the trade is made explicit rather than
 * hidden — a conversation includes the rows it looked at, and deleting it
 * deletes them. `remove` is on the card for that reason.
 *
 * Capped like the history is: a client that keeps every conversation forever
 * becomes a slow, unsearchable log of them.
 */

const LIMIT = 200;

interface ChatRow {
  id: string;
  connection_id: string | null;
  title: string;
  body: string;
  created_at: number;
  updated_at: number;
}

export class ChatRepository {
  constructor(private readonly db: AppDatabase) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat (
        id            TEXT PRIMARY KEY,
        connection_id TEXT,
        title         TEXT NOT NULL,
        body          TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS chat_recent ON chat (connection_id, updated_at DESC)');
  }

  /**
   * The cards, newest first — without their transcripts.
   *
   * A list of forty conversations would otherwise carry forty transcripts into
   * the interface to draw forty titles. The body is read only when one is
   * opened.
   */
  list(connectionId: string | null): SavedChat[] {
    const rows = this.db
      .prepare(
        `SELECT id, connection_id, title, '' AS body, created_at, updated_at
           FROM chat
          WHERE (? IS NULL OR connection_id = ?)
          ORDER BY updated_at DESC`
      )
      .all(connectionId, connectionId) as ChatRow[];

    return rows.map(toChat);
  }

  read(id: string): SavedChat | undefined {
    const row = this.db.prepare('SELECT * FROM chat WHERE id = ?').get(id) as
      ChatRow | undefined;
    return row ? toChat(row) : undefined;
  }

  save(input: SaveChatInput): SavedChat {
    const id = input.id ?? randomUUID();
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO chat (id, connection_id, title, body, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           body = excluded.body,
           updated_at = excluded.updated_at`
      )
      .run(id, input.connectionId, input.title, input.body, now, now);

    // Trimmed on write, so the table cannot grow without bound and the recent
    // list stays instant.
    this.db
      .prepare(
        `DELETE FROM chat WHERE id IN (
           SELECT id FROM chat ORDER BY updated_at DESC LIMIT -1 OFFSET ?
         )`
      )
      .run(LIMIT);

    return this.read(id)!;
  }

  rename(id: string, title: string): void {
    const trimmed = title.trim();
    if (!trimmed) return;
    this.db.prepare('UPDATE chat SET title = ? WHERE id = ?').run(trimmed, id);
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM chat WHERE id = ?').run(id);
  }
}

function toChat(row: ChatRow): SavedChat {
  return {
    id: row.id,
    connectionId: row.connection_id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
