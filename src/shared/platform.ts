/** Platform facts that both the Node side and the renderer need to agree on. */

export type PlatformId = 'macos' | 'windows' | 'linux';

export function platformIdFrom(nodePlatform: string): PlatformId {
  if (nodePlatform === 'darwin') return 'macos';
  if (nodePlatform === 'win32') return 'windows';
  return 'linux';
}

export interface PlatformInfo {
  readonly platform: PlatformId;
  /** True when the OS draws the window controls for us (macOS traffic lights). */
  readonly nativeWindowControls: boolean;
  /** Left inset the renderer must leave clear for those controls, in px. */
  readonly windowControlsInset: number;
  readonly appVersion: string;
  /** The operating system's locale, e.g. `ja-JP`. Used by "follow system". */
  readonly locale: string;
}
