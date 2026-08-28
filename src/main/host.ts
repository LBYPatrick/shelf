import { join } from 'node:path';
import {
  MessageChannelMain,
  app,
  utilityProcess,
  type BrowserWindow,
  type UtilityProcess,
} from 'electron';
import type { ConnectionConfig } from '@drivers/types';
import type { AiProvider } from '@shared/ai';

/**
 * Supervises the connection host process.
 *
 * Databases are talked to from a separate process for one reason: isolation.
 * Native database drivers are C++ that can segfault, queries can take minutes,
 * and result sets can be enormous. Any of those happening in the main process
 * would freeze every window; happening here, they cost one restart.
 *
 * Main only brokers the initial MessagePort. After that the renderer and the
 * host talk directly, so database traffic never queues behind window, menu or
 * file-dialog work on the main thread.
 */

const RESTART_BACKOFF_MS = 500;
const MAX_RAPID_RESTARTS = 5;

export class ConnectionHost {
  private process: UtilityProcess | null = null;
  private restarts = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  /** Windows that hold a port, so they can be re-attached after a restart. */
  private readonly attached = new Set<BrowserWindow>();

  start(): void {
    if (this.process) return;

    const entry = join(__dirname, 'utility.js');

    this.process = utilityProcess.fork(entry, [], {
      serviceName: 'shelf-connection-host',
      stdio: 'inherit',
      // The host writes spooled results under the app's own directory, which is
      // the one thing only this process can locate.
      env: { ...process.env, SHELF_USER_DATA: app.getPath('userData') },
    });

    this.process.once('exit', (code) => {
      this.process = null;
      if (app.isPackaged === false && code === 0) return;
      this.scheduleRestart();
    });
  }

  /**
   * Hands a window its own port pair. Each window gets a distinct session so
   * two windows never share a connection or a transaction.
   */
  attach(window: BrowserWindow, sessionId: string): void {
    this.start();
    if (!this.process) return;

    const { port1, port2 } = new MessageChannelMain();

    this.process.postMessage({ type: 'session:open', sessionId }, [port1]);
    window.webContents.postMessage('host:port', { sessionId }, [port2]);

    this.attached.add(window);
    window.once('closed', () => {
      this.attached.delete(window);
      this.process?.postMessage({ type: 'session:close', sessionId });
    });
  }

  /**
   * Hands the host a set of credentials for a session to use once. Called by
   * main immediately before the renderer asks to open or test a connection, so
   * the password goes keyring -> main -> host without passing through the
   * window.
   */
  stage(sessionId: string, handle: string, config: ConnectionConfig): void {
    this.start();
    this.process?.postMessage({ type: 'session:stage', sessionId, handle, config });
  }

  /**
   * The same arrangement for the assistant's key. It reaches the host without
   * the window ever holding it, and the handle it is filed under is consumed on
   * first use.
   */
  stageProvider(
    sessionId: string,
    handle: string,
    provider: AiProvider,
    apiKey: string | undefined
  ): void {
    this.start();
    this.process?.postMessage({
      type: 'session:stageProvider',
      sessionId,
      handle,
      provider,
      apiKey,
    });
  }

  private scheduleRestart(): void {
    if (this.restartTimer) return;

    this.restarts += 1;
    if (this.restarts > MAX_RAPID_RESTARTS) {
      // Something is reproducibly fatal. Stop thrashing and let the windows
      // show the disconnected state rather than restarting forever.
      for (const window of this.attached) {
        if (!window.isDestroyed()) window.webContents.send('host:unavailable');
      }
      return;
    }

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.start();
      for (const window of this.attached) {
        if (window.isDestroyed()) continue;
        // The renderer asks for a fresh port when it sees this; its open
        // connections are gone, and it must reconnect rather than pretend.
        window.webContents.send('host:restarted');
      }
    }, RESTART_BACKOFF_MS * this.restarts);
  }

  /** Called once the app has run for a while with a healthy host. */
  markHealthy(): void {
    this.restarts = 0;
  }

  dispose(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.process?.kill();
    this.process = null;
  }
}
