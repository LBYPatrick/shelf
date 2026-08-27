import type { DatabaseClient } from '@drivers/types';
import type { AiIntent, AiItem, AiMessage, AiRows, AiToolName, AiUsage } from '@shared/ai';
import { splitReply, systemPrompt } from '@shared/aiPrompt';
import { classifyStatement } from '@shared/sqlSafety';
import { schemaDocumentText, type SchemaDocument } from '@shared/schemaDoc';
import { gatherTables } from './schema';
import type { SchemaCache } from './schemaCache';
import {
  AiError,
  type AiAdapter,
  type AiToolCall,
  type AiToolDef,
  type AiToolResult,
  type AiWireMessage,
} from './types';

/**
 * The turn, and the rule.
 *
 * Provider-agnostic by construction: nothing below this line knows which
 * adapter is behind it, which is the property the whole layer exists to have.
 * What it does know is the one thing the interface promises about this feature
 * — **the assistant reads and never writes** — and that promise is kept here,
 * where a statement is classified before it is handed to a database, rather
 * than in the prompt, where it would be a request.
 *
 * A refused statement is not an error. It comes back to the model as a result
 * saying so, and the model does what it should have done first: writes the
 * statement out for the reader to run in their own editor. That is why the
 * refusal is worded the way it is — a model told "denied" apologises and stops;
 * a model told what to do instead does it.
 */

/** How many times the model may call a tool before the turn is cut off. */
const MAX_ROUNDS = 6;

/** Rows a tool call may bring back. Enough to check an answer, not to browse. */
const TOOL_ROW_LIMIT = 50;

/** Rows of a tool result the model is shown. The reader sees all of them. */
const MODEL_ROW_LIMIT = 20;

export const TOOLS: readonly AiToolDef[] = [
  {
    name: 'inspect_schema',
    description:
      'Read the full definition of specific tables — every column, index and foreign key. Use this when the schema you were given lists a table by name only, or when you need to be certain about a column before writing a query.',
    schema: {
      type: 'object',
      properties: {
        tables: {
          type: 'array',
          items: { type: 'string' },
          description: 'Table names, qualified with a schema where the engine has schemas.',
        },
      },
      required: ['tables'],
    },
  },
  {
    name: 'run_sql',
    description:
      'Run a read-only statement and get the rows back. Only SELECT and other statements that read are permitted; anything that writes will be refused, and you should write it out for the person to run themselves instead.',
    schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'One statement.' },
        purpose: {
          type: 'string',
          description:
            'A short title for this query, in a few words — shown to the person as its name, and used as the name of the tab if they open it. "Albums per artist", not "running a query".',
        },
        /*
         * The one thing only the model knows. Everything else about a query can
         * be worked out from the query; whether it is the answer or the working
         * that led to the answer cannot.
         */
        intent: {
          type: 'string',
          enum: ['check', 'answer'],
          description:
            "'answer' when these rows are the reply to what was asked and the person should see the table. 'check' when you are verifying something on the way — counting to be sure, sampling a column, confirming a join. A check is folded away in the conversation, so use it freely; use 'answer' only for the query whose result is the point.",
        },
      },
      required: ['sql', 'intent'],
    },
  },
];

/** What the caller does with each item as it is produced. */
export interface TurnSink {
  /** A new item, or a replacement for one already sent with the same id. */
  item(item: AiItem): void;
  /** More text for an item already sent. */
  delta(itemId: string, text: string): void;
  /**
   * One item becomes several.
   *
   * Text streams in as a single item because that is what streaming is, and
   * only once it has stopped can it be taken apart into the prose and the
   * statements it contained. Re-splitting on every token would mean
   * re-rendering a fenced block that has not finished arriving, half-parsed,
   * many times a second.
   */
  replace(itemId: string, items: readonly AiItem[]): void;
}

export interface TurnInput {
  readonly adapter: AiAdapter;
  readonly client: DatabaseClient;
  readonly document: SchemaDocument;
  readonly model: string;
  readonly maxTokens: number;
  /** The conversation so far, oldest first, not including this turn's question. */
  readonly history: readonly AiMessage[];
  readonly question: string;
  /** The interface's language, as a BCP-47 tag, for the reply to default to. */
  readonly locale?: string;
  /**
   * The connection's remembered reads, so `inspect_schema` and the document it
   * is reaching past share one. Without it the tool re-reads tables the
   * document already read a moment earlier.
   */
  readonly cache?: SchemaCache;
}

export interface TurnOutcome {
  readonly items: readonly AiItem[];
  readonly usage?: AiUsage;
}

let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${++sequence}`;

/**
 * One statement, run only if reading is all it does.
 *
 * The classification is the gate, and `unknown` fails it. A statement whose
 * first word we do not recognise is far more likely to be a dialect's own way
 * of writing something than a `SELECT` we failed to spot, and the cost of the
 * two mistakes is not symmetrical.
 */
async function runSql(
  client: DatabaseClient,
  sql: string,
  signal: AbortSignal
): Promise<
  | { readonly ok: true; readonly rows: AiRows }
  | { readonly ok: false; readonly refused: boolean; readonly message: string }
> {
  const effect = classifyStatement(sql);
  if (effect !== 'read') {
    return {
      ok: false,
      refused: true,
      message:
        `Refused: this statement would ${effect === 'schema' ? 'change the schema' : 'modify data'}, and you may only run statements that read. ` +
        'Do not try a different phrasing. Write the statement out in your reply instead, say what it would change, and tell the person they can open it in a query tab and run it themselves.',
    };
  }

  const started = Date.now();
  try {
    const results = await client.query(sql, { maxRows: TOOL_ROW_LIMIT }, signal);
    const last = results[results.length - 1];
    if (!last) return { ok: false, refused: false, message: 'The statement returned nothing.' };

    return {
      ok: true,
      rows: {
        fields: last.fields,
        rows: last.rows,
        truncated: last.truncated,
        durationMs: Date.now() - started,
      },
    };
  } catch (error) {
    return {
      ok: false,
      refused: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** What the model is shown of a result: the shape, and enough rows to reason from. */
function resultForModel(result: AiRows): string {
  const rows = result.rows.slice(0, MODEL_ROW_LIMIT);
  return JSON.stringify({
    columns: result.fields.map((field) => field.name),
    rows,
    ...(result.rows.length > rows.length
      ? { note: `${result.rows.length} rows returned; ${rows.length} shown.` }
      : {}),
    ...(result.truncated ? { truncated: true } : {}),
  });
}

export async function runTurn(
  input: TurnInput,
  sink: TurnSink,
  signal: AbortSignal
): Promise<TurnOutcome> {
  const canRun = input.adapter.capabilities.tools && input.client.capabilities.sql;
  const system = systemPrompt({
    document: input.document,
    canRun,
    ...(input.locale ? { locale: input.locale } : {}),
  });

  const messages: AiWireMessage[] = [
    ...input.history.map((message): AiWireMessage =>
      message.role === 'user'
        ? { role: 'user', text: message.text }
        : { role: 'assistant', text: message.text, calls: [] }
    ),
    { role: 'user', text: input.question },
  ];

  const items: AiItem[] = [];
  const usage: { inputTokens: number; outputTokens: number } = {
    inputTokens: 0,
    outputTokens: 0,
  };

  const emit = (item: AiItem) => {
    const at = items.findIndex((existing) => existing.id === item.id);
    if (at === -1) items.push(item);
    else items[at] = item;
    sink.item(item);
  };

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    /*
     * A fresh pair of streaming items each round. They are created lazily —
     * on the first delta rather than before the request — because a round that
     * goes straight to a tool call produces no prose, and an empty bubble
     * appearing and then never filling is the interface saying something is
     * coming when nothing is.
     */
    let textId = '';
    let textSoFar = '';
    let thinkingId = '';
    let thinkingSoFar = '';

    /*
     * Everything the model said this round, kept apart from the item buffer
     * above because that one is emptied every time an item is closed off. This
     * is what goes back on the wire as the assistant's turn, and it has to be
     * the whole of what it said, not the last paragraph of it.
     */
    let roundText = '';

    /*
     * Closes off whatever is streaming, so the next delta starts a new item
     * below whatever was emitted in between.
     *
     * This is what keeps a turn in the order it happened. An adapter that runs
     * its own tools — Claude Code does, over the loopback bridge — streams
     * prose, calls a tool, and goes on streaming, all inside one `send`. The
     * items were created on the *first* delta and appended to for the rest of
     * the session, so a sentence written after a query landed above the table
     * that query returned: the reader saw "here are the results" with nothing
     * under it, and the table arrived above the sentence a moment later.
     *
     * The split into prose and statements happens here for the same reason it
     * happens at the end of a round — parsing fences on every token would
     * re-render a block that has not finished arriving.
     */
    const sealText = (): void => {
      if (!textId) return;
      const parts = splitReply(textSoFar);
      const at = items.findIndex((item) => item.id === textId);
      const rebuilt: AiItem[] = parts.map((part, index) =>
        part.kind === 'sql'
          ? {
              kind: 'sql',
              id: `${textId}-${index}`,
              sql: part.text,
              ...(part.title ? { title: part.title } : {}),
            }
          : { kind: 'text', id: `${textId}-${index}`, text: part.text }
      );
      if (at !== -1) items.splice(at, 1, ...rebuilt);
      sink.replace(textId, rebuilt);
      textId = '';
      textSoFar = '';
    };

    const sealThinking = (): void => {
      if (!thinkingId) return;
      const at = items.findIndex((item) => item.id === thinkingId);
      if (at !== -1) items[at] = { kind: 'thinking', id: thinkingId, text: thinkingSoFar };
      thinkingId = '';
      thinkingSoFar = '';
    };

    const seal = (): void => {
      sealThinking();
      sealText();
    };

    const reply = await input.adapter.send(
      {
        model: input.model,
        system,
        messages,
        tools: canRun ? TOOLS : [],
        maxTokens: input.maxTokens,
        // Handed over whole. An adapter that returns tool calls ignores it and
        // the loop below runs them; one that calls tools itself uses this, and
        // its steps land in the same transcript by the same route.
        ...(canRun
          ? {
              execute: (call: AiToolCall) => {
                // Before the step is emitted, not after: the step has to land
                // below the prose that preceded it and above the prose that
                // follows.
                seal();
                return executeCall(input.client, call, emit, signal);
              },
            }
          : {}),
      },
      {
        text: (delta) => {
          if (!textId) {
            textId = nextId('text');
            emit({ kind: 'text', id: textId, text: '' });
          }
          textSoFar += delta;
          roundText += delta;
          sink.delta(textId, delta);
        },
        thinking: (delta) => {
          if (!thinkingId) {
            thinkingId = nextId('thinking');
            emit({ kind: 'thinking', id: thinkingId, text: '' });
          }
          thinkingSoFar += delta;
          sink.delta(thinkingId, delta);
        },
      },
      signal
    );

    usage.inputTokens += reply.usage?.inputTokens ?? 0;
    usage.outputTokens += reply.usage?.outputTokens ?? 0;

    // Whatever is still open at the end of the round is closed the same way.
    seal();

    if (reply.calls.length === 0) {
      return { items, usage };
    }

    messages.push({
      role: 'assistant',
      text: roundText,
      calls: reply.calls,
      ...(reply.raw !== undefined ? { raw: reply.raw } : {}),
    });

    const results: AiToolResult[] = [];

    for (const call of reply.calls) {
      const step = await executeCall(input.client, call, emit, signal);
      results.push(step);
    }

    messages.push({ role: 'tool', results });
  }

  emit({
    kind: 'error',
    id: nextId('error'),
    message: `Stopped after ${MAX_ROUNDS} rounds of checking. Ask again, more specifically.`,
  });

  return { items, usage };
}

async function executeCall(
  client: DatabaseClient,
  call: AiToolCall,
  emit: (item: AiItem) => void,
  signal: AbortSignal
): Promise<AiToolResult> {
  const tool = call.name as AiToolName;
  const stepId = nextId('step');

  if (tool === 'inspect_schema') {
    const tables = Array.isArray(call.input['tables'])
      ? (call.input['tables'] as unknown[]).map(String)
      : [];

    emit({
      kind: 'step',
      id: stepId,
      tool,
      state: 'running',
      label: 'Reading the schema',
      detail: tables.join(', '),
    });

    try {
      const document = await gatherTables(client, tables, input.cache);
      emit({
        kind: 'step',
        id: stepId,
        tool,
        state: 'done',
        label: 'Read the schema',
        detail: tables.join(', '),
      });
      return { id: call.id, name: call.name, content: schemaDocumentText(document) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({
        kind: 'step',
        id: stepId,
        tool,
        state: 'failed',
        label: 'Could not read the schema',
        error: message,
      });
      return { id: call.id, name: call.name, content: message, isError: true };
    }
  }

  if (tool === 'run_sql') {
    const sql = String(call.input['sql'] ?? '').trim();
    const purpose = call.input['purpose'] ? String(call.input['purpose']) : undefined;
    /*
     * A model that omits it is treated as still working, which is the quieter
     * of the two mistakes: a check shown as an answer puts a table of
     * intermediate counting in front of the reader, where an answer shown as a
     * check is one chevron away.
     */
    const intent: AiIntent = call.input['intent'] === 'answer' ? 'answer' : 'check';

    emit({
      kind: 'step',
      id: stepId,
      tool,
      state: 'running',
      label: purpose ?? 'Running a query',
      sql,
      intent,
    });

    const outcome = await runSql(client, sql, signal);

    if (outcome.ok) {
      emit({
        kind: 'step',
        id: stepId,
        tool,
        state: 'done',
        label: purpose ?? 'Ran a query',
        sql,
        intent,
        detail: `${outcome.rows.rows.length} rows · ${outcome.rows.durationMs} ms`,
        rows: outcome.rows,
      });
      return { id: call.id, name: call.name, content: resultForModel(outcome.rows) };
    }

    emit({
      kind: 'step',
      id: stepId,
      tool,
      state: outcome.refused ? 'denied' : 'failed',
      label: outcome.refused ? 'Not run — this would change the database' : 'The query failed',
      sql,
      intent,
      ...(outcome.refused ? {} : { error: outcome.message }),
    });

    return { id: call.id, name: call.name, content: outcome.message, isError: true };
  }

  // A model calling a tool that does not exist is told so rather than being
  // left waiting; the alternative is a turn that hangs on a result nobody will
  // ever produce.
  throw new AiError(`The model asked for a tool that does not exist: ${call.name}`);
}
