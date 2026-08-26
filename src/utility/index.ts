import { registerEngines } from '@drivers/index';
import { serializeError, type RpcOutbound } from '@shared/rpc';
import { handlers, type Handler } from './handlers';
import { Session, sessions } from './session';
import type { HostChannel } from '@shared/contract';
import type { ConnectionConfig } from '@drivers/types';
import type { AiProvider } from '@shared/ai';

/**
 * The connection host.
 *
 * Every live database connection runs in this process. Main brokers one
 * MessagePort per window and then steps out of the way, so database traffic
 * never contends with window, menu or dialog work on the main thread — and a
 * driver that crashes takes only this process with it.
 */

registerEngines();

interface SessionOpen {
  type: 'session:open';
  sessionId: string;
}

interface SessionClose {
  type: 'session:close';
  sessionId: string;
}

/**
 * Credentials pushed by main. They arrive here directly from the keyring, so
 * the renderer only ever holds the opaque handle.
 */
interface StageCredentials {
  type: 'session:stage';
  sessionId: string;
  handle: string;
  config: ConnectionConfig;
}

/**
 * A provider's key, pushed by main for the same reason a password is: the
 * interface process is never given one.
 */
interface StageProvider {
  type: 'session:stageProvider';
  sessionId: string;
  handle: string;
  provider: AiProvider;
  apiKey?: string;
}

type HostMessage = SessionOpen | SessionClose | StageCredentials | StageProvider;

function attachPort(session: Session, port: Electron.MessagePortMain): void {
  const reply = (message: unknown) => {
    try {
      port.postMessage(message);
    } catch {
      // The window went away mid-request; nothing to deliver the answer to.
    }
  };

  /*
   * The channel the host pushes down without being asked — a turn's tokens as
   * they arrive, an export's progress. Assigned here rather than passed to each
   * handler because a handler that needs it is deep inside an agent loop, and
   * threading a callback through would put the transport in every signature.
   */
  session.emit = (channel, payload) => reply({ kind: 'event', channel, payload });

  port.on('message', (event) => {
    const message = event.data as RpcOutbound;

    if (message.kind === 'cancel') {
      session.inFlight.get(message.id)?.abort();
      return;
    }

    if (message.kind !== 'request') return;

    const { id, channel, payload } = message;
    const handler = handlers[channel as HostChannel] as Handler<HostChannel> | undefined;

    if (!handler) {
      reply({
        kind: 'reply',
        id,
        ok: false,
        error: serializeError(new Error(`Unknown channel: ${channel}`)),
      });
      return;
    }

    const controller = new AbortController();
    session.inFlight.set(id, controller);

    void Promise.resolve()
      .then(() => handler(session, payload as never, controller.signal))
      .then(
        (result) => reply({ kind: 'reply', id, ok: true, result }),
        (error: unknown) =>
          reply({ kind: 'reply', id, ok: false, error: serializeError(error) })
      )
      .finally(() => session.inFlight.delete(id));
  });

  port.start();
}

process.parentPort?.on('message', (event) => {
  const message = event.data as HostMessage;

  if (message.type === 'session:open') {
    const [port] = event.ports;
    if (!port) return;

    const session = new Session(message.sessionId);
    sessions.set(message.sessionId, session);
    attachPort(session, port);
    return;
  }

  if (message.type === 'session:stage') {
    sessions.get(message.sessionId)?.stage(message.handle, message.config);
    return;
  }

  if (message.type === 'session:stageProvider') {
    sessions.get(message.sessionId)?.stageProvider(message.handle, {
      provider: message.provider,
      ...(message.apiKey ? { apiKey: message.apiKey } : {}),
    });
    return;
  }

  if (message.type === 'session:close') {
    const session = sessions.get(message.sessionId);
    if (!session) return;
    sessions.delete(message.sessionId);
    void session.dispose();
  }
});

// A driver that rejects out of band should not take the whole host down with
// it: log it and keep the other connections alive.
process.on('unhandledRejection', (reason) => {
  console.error('[connection host] unhandled rejection', reason);
});
