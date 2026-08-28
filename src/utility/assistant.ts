import { runTurn } from '@ai/agent';
import { requireSignIn } from '@ai/installed';
import { createAiAdapter } from '@ai/registry';
import { gatherSchema } from '@ai/schema';
import type { AiPhase, AiTurn } from '@shared/ai';
import type { SchemaScope } from '@shared/schemaDoc';
import type { Session } from './session';

/**
 * The assistant's handlers, kept out of `handlers.ts`.
 *
 * Not a matter of file length. Everything in the handler registry is a line
 * that forwards a call to a driver; these two assemble a schema document, an
 * adapter and an agent loop, and putting forty lines of that between
 * `data/count` and `query/run` would bury the shape of the registry itself.
 */

/**
 * How much of a schema goes in a prompt, in estimated tokens.
 *
 * Not the size of the context window. A model reading fifty thousand tokens of
 * table definitions is a model that is slower, dearer, and — the part that
 * matters — worse at noticing the six tables the question is actually about.
 * The rest of the database is a name away: `inspect_schema` reads any table in
 * full, and the document says so.
 */
const SCHEMA_BUDGET = 24_000;

/** Room to explain and to write a long query. Not a ceiling anyone reaches. */
const CHAT_TOKENS = 16_000;

export async function schemaFor(
  session: Session,
  connectionId: string,
  scope: SchemaScope,
  budget: number | undefined,
  signal: AbortSignal
) {
  const client = session.require(connectionId);
  return gatherSchema(client, scope, {
    budget: budget ?? SCHEMA_BUDGET,
    signal,
    cache: session.schemaCache(connectionId),
  });
}

export async function turn(
  session: Session,
  payload: {
    connectionId: string;
    handle: string;
    turnId: string;
    scope: SchemaScope;
    history: readonly { role: 'user' | 'assistant'; text: string }[];
    question: string;
    locale?: string;
  },
  signal: AbortSignal
): Promise<AiTurn> {
  const client = session.require(payload.connectionId);
  const staged = session.consumeProvider(payload.handle);

  /*
   * Before anything else, and before the schema in particular.
   *
   * A command-line assistant that nobody is signed in to is the one failure
   * that cannot be fixed from inside this window, and it used to arrive as
   * nothing at all: the subprocess waited for a login it had no terminal to ask
   * for, and the chat sat on "Reading the schema…" indefinitely. Asking first
   * costs one cheap status command and turns an indefinite wait into a sheet
   * with the command to run in it.
   */
  await requireSignIn(staged.provider.driver);

  const adapter = createAiAdapter(staged.provider, staged.apiKey);

  const cache = session.schemaCache(payload.connectionId);

  /*
   * Which half of the wait this is.
   *
   * Reading the schema and waiting for a model are seconds of nothing on
   * screen either way, and the interface called both of them "Reading the
   * schema…" — which was true on a connection's first turn and a lie on every
   * one after it, because the reads are cached. Saying which is happening costs
   * two events a turn.
   */
  const phase = (which: AiPhase) =>
    session.emit('ai/phase', { turnId: payload.turnId, phase: which });

  phase('schema');
  const document = await gatherSchema(client, payload.scope, {
    budget: SCHEMA_BUDGET,
    signal,
    cache,
  });
  phase('waiting');

  const outcome = await runTurn(
    {
      adapter,
      client,
      document,
      model: staged.provider.model,
      maxTokens: CHAT_TOKENS,
      history: payload.history,
      question: payload.question,
      cache,
      ...(payload.locale ? { locale: payload.locale } : {}),
    },
    {
      item: (item) => session.emit('ai/item', { turnId: payload.turnId, item }),
      delta: (itemId, text) =>
        session.emit('ai/delta', { turnId: payload.turnId, itemId, text }),
      replace: (itemId, items) =>
        session.emit('ai/replace', { turnId: payload.turnId, itemId, items }),
    },
    signal
  );

  return {
    id: payload.turnId,
    items: outcome.items,
    ...(outcome.usage ? { usage: outcome.usage } : {}),
  };
}

/**
 * Does this provider answer.
 *
 * Deliberately a real request rather than a reachability check: the failures
 * worth catching in a settings pane are a wrong key, a model name that does not
 * exist for this account, and a base URL pointing at something that is not a
 * model server — and none of those is a connection failure. One token is enough
 * to find all three out.
 */
export async function probe(
  session: Session,
  handle: string,
  signal: AbortSignal
): Promise<{ ok: true } | { ok: false; message: string }> {
  const staged = session.consumeProvider(handle);

  try {
    const adapter = createAiAdapter(staged.provider, staged.apiKey);
    await adapter.send(
      {
        model: staged.provider.model,
        system: 'Reply with the single word: ready.',
        messages: [{ role: 'user', text: 'ready?' }],
        tools: [],
        maxTokens: 16,
      },
      { text: () => undefined, thinking: () => undefined },
      signal
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
