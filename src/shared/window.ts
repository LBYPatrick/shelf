/** Window-chrome channels. Kept separate from the database RPC contract. */

export const WINDOW_CHANNELS = {
  minimize: 'window:minimize',
  toggleMaximize: 'window:toggle-maximize',
  close: 'window:close',
  isMaximized: 'window:is-maximized',
  maximizedChanged: 'window:maximized-changed',
  platformInfo: 'window:platform-info',
} as const;

export const DIALOG_CHANNELS = {
  openFile: 'dialog:open-file',
  saveFile: 'dialog:save-file',
} as const;

export interface DialogApi {
  /** Returns the chosen path, or undefined if the user cancelled. */
  openFile(options: {
    title?: string;
    extensions?: readonly string[];
    allowCreate?: boolean;
  }): Promise<string | undefined>;
  saveFile(options: {
    title?: string;
    defaultPath?: string;
    extensions?: readonly string[];
  }): Promise<string | undefined>;
}

/** Channels for obtaining and re-obtaining the connection host's port. */
export const HOST_CHANNELS = {
  requestPort: 'host:request-port',
  port: 'host:port',
  restarted: 'host:restarted',
  unavailable: 'host:unavailable',
} as const;

export interface HostBridge {
  /** Asks main to broker a fresh MessagePort; it arrives via `onPort`. */
  requestPort(): void;
  /** Fires when the host process restarted and open connections were lost. */
  onRestarted(listener: () => void): () => void;
  /** Fires when the host failed repeatedly and will not be restarted again. */
  onUnavailable(listener: () => void): () => void;
}

export interface WindowApi {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  isMaximized(): Promise<boolean>;
  onMaximizedChanged(listener: (maximized: boolean) => void): () => void;
}
