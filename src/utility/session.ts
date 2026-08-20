import type { ConnectionConfig, DatabaseClient } from '@drivers/types';
import type { Tunnel } from './tunnel';

/**
 * Per-window state inside the connection host.
 *
 * Each window owns a session, and each session owns its connections. Two
 * windows never share a client, because sharing one would mean sharing its
 * transaction state — committing in one window would commit the other's work.
 */
export class Session {
  readonly connections = new Map<string, DatabaseClient>();
  /**
   * Credentials staged by the main process, keyed by a single-use handle. They
   * are consumed on first use so a leaked handle cannot be replayed.
   */
  private readonly staged = new Map<string, ConnectionConfig>();
  /** In-flight cancellable work, keyed by RPC request id. */
  readonly inFlight = new Map<number, AbortController>();
  /**
   * The forwarders in front of connections that need one.
   *
   * Owned by the session rather than by the client, because a driver has no
   * idea it is being proxied — which is the whole design — and so cannot be the
   * thing that closes the listener.
   */
  readonly tunnels = new Map<string, Tunnel>();

  constructor(readonly id: string) {}

  stage(handle: string, config: ConnectionConfig): void {
    this.staged.set(handle, config);
  }

  consume(handle: string): ConnectionConfig {
    const config = this.staged.get(handle);
    if (!config) {
      throw new Error('Connection credentials expired; try connecting again.');
    }
    this.staged.delete(handle);
    return config;
  }

  require(connectionId: string): DatabaseClient {
    const client = this.connections.get(connectionId);
    if (!client) {
      throw new Error(`No open connection: ${connectionId}`);
    }
    return client;
  }

  /** Takes down the forwarder for one connection, if it had one. */
  async closeTunnel(connectionId: string): Promise<void> {
    const tunnel = this.tunnels.get(connectionId);
    if (!tunnel) return;
    this.tunnels.delete(connectionId);
    await tunnel.close().catch(() => undefined);
  }

  async dispose(): Promise<void> {
    for (const controller of this.inFlight.values()) controller.abort();
    this.inFlight.clear();
    this.staged.clear();

    await Promise.allSettled(
      [...this.connections.values()].map((client) => client.disconnect())
    );
    this.connections.clear();

    await Promise.allSettled([...this.tunnels.values()].map((tunnel) => tunnel.close()));
    this.tunnels.clear();
  }
}

export const sessions = new Map<string, Session>();
