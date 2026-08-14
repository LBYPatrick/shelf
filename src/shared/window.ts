/** Window-chrome channels. Kept separate from the database RPC contract. */

export const WINDOW_CHANNELS = {
  minimize: 'window:minimize',
  toggleMaximize: 'window:toggle-maximize',
  close: 'window:close',
  isMaximized: 'window:is-maximized',
  maximizedChanged: 'window:maximized-changed',
  platformInfo: 'window:platform-info',
  setAppearance: 'window:set-appearance',
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

/** `system` follows the OS; anything else overrides it. */
export type Appearance = 'system' | 'light' | 'dark';

export interface WindowApi {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  isMaximized(): Promise<boolean>;
  onMaximizedChanged(listener: (maximized: boolean) => void): () => void;
  /**
   * Tells the OS which appearance the interface is wearing.
   *
   * The window's material is painted by the OS behind the page, so the OS has
   * to be told — a `data-theme` attribute is invisible to it. Without this a
   * dark interface on a light desktop got the *light* vibrancy material: a pale
   * frosted sidebar and status bar against a near-black content pane, which is
   * the exact inverse of the depth those panels are supposed to have.
   */
  setAppearance(appearance: Appearance): void;
}
