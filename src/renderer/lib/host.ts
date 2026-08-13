import type {
  HostChannel,
  HostEventName,
  HostEvents,
  HostPayload,
  HostResult,
} from '@shared/contract';
import { RpcCancelled, RpcError, type RpcInbound } from '@shared/rpc';

/**
 * The renderer's client for the connection host.
 *
 * Requests are queued until the port arrives, so callers never have to know
 * whether the connection host has finished starting. Cancellation is forwarded
 * as a real message: abandoning the promise would leave the database still
 * running the query.
 */
export class HostClient {
  private port: MessagePort | null = null;
  private nextId = 1;

  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: unknown) => void }
  >();

  /** Requests made before the port arrived. */
  private readonly queue: unknown[] = [];

  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();

  attach(port: MessagePort): void {
    this.port = port;
    port.onmessage = (event) => this.receive(event.data as RpcInbound);
    port.start();

    for (const message of this.queue.splice(0)) port.postMessage(message);
  }

  /**
   * The host restarted, so every connection it held is gone. Reject what was in
   * flight rather than leaving callers hanging on answers that will never come.
   */
  detach(reason: string): void {
    this.port = null;
    for (const { reject } of this.pending.values()) {
      reject(new RpcError({ name: 'HostUnavailable', message: reason }));
    }
    this.pending.clear();
  }

  call<K extends HostChannel>(
    channel: K,
    payload: HostPayload<K>,
    signal?: AbortSignal
  ): Promise<HostResult<K>> {
    const id = this.nextId++;

    return new Promise<HostResult<K>>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new RpcCancelled());
        return;
      }

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      signal?.addEventListener(
        'abort',
        () => {
          if (!this.pending.has(id)) return;
          this.pending.delete(id);
          this.send({ kind: 'cancel', id });
          reject(new RpcCancelled());
        },
        { once: true }
      );

      this.send({ kind: 'request', id, channel, payload: this.plain(payload) });
    });
  }

  on<E extends HostEventName>(
    event: E,
    listener: (payload: HostEvents[E]) => void
  ): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as (payload: unknown) => void);
    this.listeners.set(event, set);
    return () => set.delete(listener as (payload: unknown) => void);
  }

  /**
   * Strips anything a MessagePort cannot carry.
   *
   * Payloads are built from Vue state, and a reactive object is a Proxy —
   * structured clone rejects it outright. Serialising here rather than asking
   * every call site to remember `toRaw` means a request can be assembled from
   * reactive state without thinking about it. Request payloads are small; the
   * large data travels the other way, untouched.
   */
  private plain<T>(payload: T): T {
    if (payload === undefined || payload === null) return payload;
    return JSON.parse(JSON.stringify(payload)) as T;
  }

  private send(message: unknown): void {
    if (this.port) this.port.postMessage(message);
    else this.queue.push(message);
  }

  private receive(message: RpcInbound): void {
    if (message.kind === 'event') {
      for (const listener of this.listeners.get(message.channel) ?? []) {
        listener(message.payload);
      }
      return;
    }

    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);

    if (message.ok) entry.resolve(message.result);
    else entry.reject(new RpcError(message.error));
  }
}

export const host = new HostClient();
