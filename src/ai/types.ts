/**
 * The one abstraction every model provider implements.
 *
 * The same shape the database drivers have, and for the same reason: four
 * providers sit behind this interface and three of them disagree about
 * everything below the first sentence — what a system prompt is, whether a tool
 * call is a content block or a field, how a stream is framed. The design rule
 * carries over too. Differences are *declared* through `capabilities` rather
 * than thrown, so the agent above never calls something and catches "not
 * supported".
 *
 * What crosses this boundary is deliberately small: text in, text and tool
 * calls out. Everything a provider is proud of — thinking blocks, citations,
 * server-side tools, its own idea of a conversation id — either maps onto this
 * or is the adapter's own business. An agent that knew which provider it was
 * talking to would be a second place for every provider's quirks to live.
 *
 * This file is host-side. It imports Node's `fetch` transitively through its
 * implementations and must never be reachable from the renderer.
 */

import { AI_NOT_SIGNED_IN } from '@shared/ai';
import type { AiCapabilities, AiDriverKind, AiProvider, AiToolName, AiUsage } from '@shared/ai';

/** A tool, as every provider's JSON-schema dialect happens to agree on it. */
export interface AiToolDef {
  readonly name: AiToolName;
  readonly description: string;
  readonly schema: {
    readonly type: 'object';
    readonly properties: Readonly<Record<string, unknown>>;
    readonly required?: readonly string[];
  };
}

export interface AiToolCall {
  /** The provider's id for this call, echoed back with its result. */
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface AiToolResult {
  readonly id: string;
  readonly name: string;
  readonly content: string;
  readonly isError?: boolean;
}

/**
 * One turn of the conversation as the wire sees it.
 *
 * Distinct from `AiMessage` in the shared contract, which is what the *reader*
 * said and was told. This carries the tool traffic as well, which the reader
 * never types and the interface draws as steps rather than as messages.
 */
export type AiWireMessage =
  | {
      readonly role: 'user';
      readonly text: string;
      /**
       * Pictures to send with this turn, for an adapter that takes them.
       *
       * Only ever set on the message being asked *now* — the history is what
       * was said, and re-sending every image from every earlier turn would grow
       * a conversation's cost without being asked to. Adapters that declare
       * `images: false` never see this field set, because the composer does not
       * let one be attached in the first place.
       */
      readonly images?: readonly { readonly mediaType: string; readonly base64: string }[];
    }
  | {
      readonly role: 'assistant';
      readonly text: string;
      readonly calls: readonly AiToolCall[];
      /**
       * What the provider actually said, kept so it can be said back.
       *
       * Opaque here on purpose — the agent never looks inside it. It exists
       * because a turn is not always reconstructible from its text: a provider
       * that returns reasoning alongside the answer requires that reasoning
       * back verbatim when the tool results are returned, and rebuilding the
       * message from text and calls silently drops it. An adapter that needs
       * nothing of the kind leaves it unset and reads the two fields above.
       */
      readonly raw?: unknown;
    }
  | { readonly role: 'tool'; readonly results: readonly AiToolResult[] };

export interface AiRequest {
  readonly model: string;
  readonly system: string;
  readonly messages: readonly AiWireMessage[];
  readonly tools: readonly AiToolDef[];
  readonly maxTokens: number;
  /**
   * How to run a tool, for an adapter that does its own calling.
   *
   * Most providers hand back the calls they want made and the loop above runs
   * them. One does not: Claude Code is a subprocess with an agent loop of its
   * own, and it reaches tools over MCP rather than by asking. So it is given
   * this instead — the very same executor the loop uses, so a query it runs
   * appears in the conversation as a step and a table exactly as one the loop
   * ran would, and is refused by the same rule if it writes.
   */
  readonly execute?: (call: AiToolCall) => Promise<AiToolResult>;
}

/**
 * Where the text goes while it is still arriving.
 *
 * A callback rather than a returned stream because the caller is a plain
 * `await` inside an RPC handler, and an async iterator there would mean the
 * handler owning a second loop for no reason. The deltas leave the process as
 * events; the reply is what the request resolves to.
 */
export interface AiSink {
  text(delta: string): void;
  /**
   * The model's own account of how it is getting there, where the provider
   * offers one and the reader has asked to see it.
   *
   * Separate from `text` rather than merged into it, because they are not the
   * same claim: one is the answer and the other is working. Drawn as a distinct
   * item that folds away, so a chat is not two thirds transcript.
   */
  thinking(delta: string): void;
}

export type AiStop = 'end' | 'tools' | 'length' | 'refusal';

export interface AiReply {
  readonly text: string;
  readonly calls: readonly AiToolCall[];
  readonly stop: AiStop;
  readonly usage?: AiUsage;
  /** Passed back on the next request; see `AiWireMessage`. */
  readonly raw?: unknown;
}

export interface AiAdapter {
  readonly kind: AiDriverKind;
  readonly capabilities: AiCapabilities;
  /**
   * One round trip. Streams text into the sink as it arrives and resolves with
   * everything the model said, including any tools it wants run.
   */
  send(request: AiRequest, sink: AiSink, signal: AbortSignal): Promise<AiReply>;
}

/**
 * A driver builds adapters; an instance is what it builds one from.
 *
 * Split for the reason the sibling project split them: the driver is the
 * implementation and the instance is the configuration, so two accounts of one
 * provider are two instances rather than a setting toggled back and forth.
 */
export interface AiDriver {
  readonly kind: AiDriverKind;
  readonly capabilities: AiCapabilities;
  create(instance: AiProvider, apiKey: string | undefined): AiAdapter;
}

/**
 * A provider's own error, made legible.
 *
 * Providers return a 400 with a JSON body explaining exactly what is wrong, and
 * the thing a reader most needs to see — "your credit balance is too low", "no
 * such model" — is inside it. Surfacing "Request failed with status 400" throws
 * that away and produces a support question.
 */
export class AiError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AiError';
    this.status = status;
  }
}

/**
 * A provider that is on this machine and has nobody signed in to it.
 *
 * Its own failure, not the database's and not the model's, and the only one
 * whose fix is somewhere else entirely: a terminal. So it carries a code the
 * interface can branch on rather than a sentence it has to match, and the kind
 * of CLI, so the sheet it raises can name the command to run.
 */
export class AiSignInError extends AiError {
  /** Read by `serializeError`, which is how this crosses to the renderer. */
  readonly code = AI_NOT_SIGNED_IN;
  readonly kind: AiDriverKind;

  constructor(kind: AiDriverKind, message: string) {
    super(message);
    this.name = 'AiSignInError';
    this.kind = kind;
  }
}

/** Reads whatever a provider put in a failed response body. */
export async function describeFailure(response: Response): Promise<AiError> {
  const body = await response.text().catch(() => '');
  let detail = body.slice(0, 400);

  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string } | string;
      message?: string;
    };
    const error = parsed.error;
    detail = (typeof error === 'string' ? error : error?.message) ?? parsed.message ?? detail;
  } catch {
    // Not JSON. The first few hundred characters of whatever it was will have
    // to do, and is still more use than the status code alone.
  }

  return new AiError(detail || `The provider returned ${response.status}.`, response.status);
}
