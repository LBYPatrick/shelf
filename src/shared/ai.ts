/**
 * The assistant, as a contract.
 *
 * Ported from the sibling project's provider layer, and the idea worth porting
 * is the split it makes: a **driver** is an implementation — which protocol,
 * which wire format, which way of streaming — and an **instance** is a
 * configuration the reader named. Threads reference the instance, never the
 * driver, so two accounts of the same provider are two entries in a list rather
 * than a setting that has to be changed back and forth.
 *
 * The second idea is the one this codebase already believes: the orchestration
 * does not know which provider is behind a turn. Every adapter normalises its
 * provider's stream into one event vocabulary, and the interface renders that.
 * Adding a provider is a file in `src/ai/drivers` and a row in the catalogue;
 * it is not a change to the chat, the contract, or the store.
 *
 * Nothing here imports a driver or touches the network — this is the shape both
 * sides agree on, and the renderer is allowed to hold it.
 */

import type { EntityRef, Field, Row } from '../drivers/types';
import type { SchemaScope } from './schemaDoc';

/** Which implementation answers for an instance. */
export type AiDriverKind =
  'claudeCode' | 'anthropic' | 'openai' | 'google' | 'openaiCompatible';

/**
 * One configured provider.
 *
 * The key is not here, and never is: it lives in the OS keyring and travels
 * keyring → main → host exactly the way a database password does. What the
 * renderer holds is enough to draw a row in a list.
 */
export interface AiProvider {
  readonly id: string;
  /** What the reader called it. Shown everywhere the provider is named. */
  readonly name: string;
  readonly driver: AiDriverKind;
  readonly model: string;
  /** Set when the reader is pointing a driver somewhere other than its home. */
  readonly baseUrl?: string;
  readonly createdAt: number;
}

/** A provider being written, before it has an id. */
export interface AiProviderInput {
  readonly id?: string;
  readonly name: string;
  readonly driver: AiDriverKind;
  readonly model: string;
  readonly baseUrl?: string;
  /** Absent means "leave whatever is stored"; empty string means "forget it". */
  readonly apiKey?: string;
}

/**
 * What a driver can do, declared rather than discovered.
 *
 * The same rule the database drivers follow: the interface reads a capability
 * and omits what is not there, instead of calling something and catching
 * "unsupported". A provider without tool use still answers questions — it
 * simply never offers to run the query itself.
 */
export interface AiCapabilities {
  readonly streaming: boolean;
  readonly tools: boolean;
  /** Takes a system prompt as its own field rather than as a first message. */
  readonly system: boolean;
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

export type AiRole = 'user' | 'assistant';

/** One side of the exchange, as plain text. */
export interface AiMessage {
  readonly role: AiRole;
  readonly text: string;
}

// ---------------------------------------------------------------------------
// What a turn produces
// ---------------------------------------------------------------------------

/**
 * One thing in a turn.
 *
 * A turn is a list of these rather than a string, which is what makes the chat
 * a place where a query can be run and a table looked at rather than a
 * transcript with code in it. Every kind is something the interface draws
 * differently, and nothing here is markup the renderer has to parse back out.
 */
export type AiItem =
  | { readonly kind: 'text'; readonly id: string; readonly text: string }
  /**
   * The model's reasoning, where it offers a summary of it.
   *
   * Folded away by default and drawn quieter than the answer. It is here
   * because the alternative during a long turn is a spinner and nothing else —
   * and a reader who cannot see that the assistant has understood the question
   * has no reason to keep waiting.
   */
  | { readonly kind: 'thinking'; readonly id: string; readonly text: string }
  /** SQL the assistant wrote out, offered rather than run. */
  | {
      readonly kind: 'sql';
      readonly id: string;
      readonly sql: string;
      /** What to call it, above the code and on the tab it opens. */
      readonly title?: string;
    }
  /**
   * A step it took: reading the schema, or running a statement.
   *
   * A run carries everything about itself — the statement, how it ended, and
   * the rows it got back — because to the reader those are one thing. They used
   * to be two items in a row, a step and a table, which meant the table could
   * not fold away with the step that produced it.
   */
  | {
      readonly kind: 'step';
      readonly id: string;
      readonly tool: AiToolName;
      readonly state: 'running' | 'done' | 'failed' | 'denied';
      readonly label: string;
      readonly detail?: string;
      readonly sql?: string;
      /**
       * Whether this query is working or is the answer.
       *
       * The model says which, and the difference is the whole of how a turn
       * reads: a conversation that shows five tables of intermediate counting
       * buries the one table that was asked for. Working folds away; the answer
       * is open.
       */
      readonly intent?: AiIntent;
      readonly rows?: AiRows;
      readonly error?: string;
    }
  | { readonly kind: 'error'; readonly id: string; readonly message: string };

/**
 * The two things the assistant is allowed to do to a database.
 *
 * It reads, and it does not write. There is no setting here, and that is the
 * design rather than an omission: the alternative was a permission prompt per
 * statement, and a prompt that appears for `SELECT 1` is a prompt people learn
 * to click through — so the one time it says `DROP` they click through that
 * too. A rule the reader is told once and can rely on is worth more than a
 * dialog they have stopped reading.
 *
 * So a statement is classified before it runs, and only a read runs. Anything
 * else comes back as SQL in the conversation with an offer to open it in a
 * query tab, where running it is the reader's own gesture against their own
 * editor — which is where a write belongs. Enforced in `src/ai/agent.ts`,
 * never in the prompt: a rule a model is asked to follow is a rule.
 */
export type AiToolName = 'inspect_schema' | 'run_sql';

/**
 * What a query was for.
 *
 * `check` is the assistant working — counting something to be sure, looking at
 * a handful of rows before committing to a join. `answer` is the query whose
 * rows *are* the reply. Asked for explicitly rather than guessed, because the
 * only thing that can tell them apart is the intent behind writing it.
 */
export type AiIntent = 'check' | 'answer';

/** Rows a query brought back, as the conversation draws them. */
export interface AiRows {
  readonly fields: readonly Field[];
  readonly rows: readonly Row[];
  readonly truncated: boolean;
  readonly durationMs: number;
}

export interface AiUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

/** A turn the interface can hold on to, which is a turn and its items. */
export interface AiTurn {
  readonly id: string;
  readonly items: readonly AiItem[];
  readonly usage?: AiUsage;
}

// ---------------------------------------------------------------------------
// Events the host pushes while a turn is running
// ---------------------------------------------------------------------------

/** A whole item arrived, or an existing one changed state. */
export interface AiItemEvent {
  readonly turnId: string;
  readonly item: AiItem;
}

/** Text appended to an item already on screen. */
export interface AiDeltaEvent {
  readonly turnId: string;
  readonly itemId: string;
  readonly text: string;
}

/**
 * One item turned out to be several.
 *
 * Sent when a block of streamed text has stopped arriving and can finally be
 * taken apart into the prose and the statements it held. The interface swaps
 * the placeholder for the parts in place, so the SQL block appears where the
 * text it was inside already was.
 */
export interface AiReplaceEvent {
  readonly turnId: string;
  readonly itemId: string;
  readonly items: readonly AiItem[];
}

export { type SchemaScope };
export type { EntityRef };
