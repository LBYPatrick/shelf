/**
 * The wire protocol between the renderer and the connection host.
 *
 * Requests carry an id; replies carry the same id. Cancellation is a separate
 * message rather than a dropped promise, because a cancelled query has to be
 * cancelled *at the database* — abandoning the promise would leave the server
 * doing the work.
 *
 * The host may also push unsolicited events (export progress, a connection
 * dropping), which is why this is a message protocol and not request/response
 * only.
 */

export interface RpcRequest {
  readonly kind: 'request';
  readonly id: number;
  readonly channel: string;
  readonly payload: unknown;
}

export interface RpcCancel {
  readonly kind: 'cancel';
  readonly id: number;
}

export interface RpcSuccess {
  readonly kind: 'reply';
  readonly id: number;
  readonly ok: true;
  readonly result: unknown;
}

export interface RpcFailure {
  readonly kind: 'reply';
  readonly id: number;
  readonly ok: false;
  readonly error: SerializedError;
}

export interface RpcEvent {
  readonly kind: 'event';
  readonly channel: string;
  readonly payload: unknown;
}

export type RpcOutbound = RpcRequest | RpcCancel;
export type RpcInbound = RpcSuccess | RpcFailure | RpcEvent;

/**
 * Errors cannot cross a message port intact, so they are flattened. The code is
 * what callers branch on; the message is what the user reads.
 */
export interface SerializedError {
  readonly name: string;
  readonly message: string;
  /** Driver-specific code, e.g. Postgres `28P01` for a bad password. */
  readonly code?: string;
  readonly stack?: string;
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return {
      name: error.name,
      message: error.message,
      ...(typeof code === 'string' || typeof code === 'number' ? { code: String(code) } : {}),
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return { name: 'Error', message: String(error) };
}

/** Rebuilt on the renderer side so callers can `catch` a real Error. */
export class RpcError extends Error {
  readonly code: string | undefined;
  readonly remoteStack: string | undefined;

  constructor(serialized: SerializedError) {
    super(serialized.message);
    this.name = serialized.name;
    this.code = serialized.code;
    this.remoteStack = serialized.stack;
  }
}

/** Thrown when a request is cancelled by the caller. */
export class RpcCancelled extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'RpcCancelled';
  }
}
