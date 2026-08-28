/** Window-chrome channels. Kept separate from the database RPC contract. */

export const WINDOW_CHANNELS = {
  minimize: 'window:minimize',
  toggleMaximize: 'window:toggle-maximize',
  close: 'window:close',
  isMaximized: 'window:is-maximized',
  maximizedChanged: 'window:maximized-changed',
  platformInfo: 'window:platform-info',
  setAppearance: 'window:set-appearance',
  setCompact: 'window:set-compact',
  notify: 'window:notify',
} as const;

export const DIALOG_CHANNELS = {
  openFile: 'dialog:open-file',
  saveFile: 'dialog:save-file',
  readTextFile: 'dialog:read-text-file',
  writeTextFile: 'dialog:write-text-file',
  writeBinaryFile: 'dialog:write-binary-file',
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
  /**
   * Picks a text file and reads it, in one round trip.
   *
   * Separate from `openFile` because the renderer cannot read a path: it has no
   * filesystem, deliberately. A settings or connection document is a few
   * kilobytes, so it crosses whole rather than as a stream — the one that can
   * be arbitrarily large is table data, and that goes through the host.
   */
  readTextFile(options: {
    title?: string;
    extensions?: readonly string[];
  }): Promise<{ path: string; text: string } | undefined>;
  /** Picks a destination and writes it. Returns the path, or undefined if the
   *  user cancelled. */
  writeTextFile(
    options: { title?: string; defaultPath?: string; extensions?: readonly string[] },
    text: string
  ): Promise<string | undefined>;
  /**
   * The same, for something that is not text.
   *
   * Base64 rather than a `Uint8Array`, because the bridge clones what crosses
   * it and a typed array arrives on the other side as a plain object of indices
   * — silently, and only for large ones. A plan diagram is a few tens of
   * kilobytes, so the third it costs to encode is not worth a second mechanism.
   */
  writeBinaryFile(
    options: { title?: string; defaultPath?: string; extensions?: readonly string[] },
    base64: string
  ): Promise<string | undefined>;
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
  /**
   * Whether the window is showing the start screen rather than a workspace.
   *
   * The two want different windows. A workspace is a tool you size to your
   * screen; a start screen is a panel with a title, a short list and two ways
   * in, and given a full-screen window it is mostly emptiness. So the window
   * shrinks to fit it and grows back to whatever it was when a database opens.
   */
  setCompact(compact: boolean): void;
  /**
   * Hands a notice to the operating system.
   *
   * Only reaches the desktop when this window is *not* the one being looked at.
   * The renderer asks whenever it raises something worth reading and main is
   * the one that decides, because "is the window focused" is a fact only main
   * can answer without racing: by the time an answer travelled to the renderer
   * and a notification travelled back, the reader could have switched twice.
   *
   * The in-app notice is raised either way. Dropping it while the window is
   * hidden would mean a message that only ever existed in a banner somebody may
   * not have been at their desk for.
   */
  notify(notice: { title: string; body: string }): void;
}
