import { ipcMain } from 'electron';
import { UPDATE_CHANNELS } from '@shared/updates';
import type { Updater } from '../updates';

/**
 * The update flow, as channels.
 *
 * Every one of these answers with the whole state rather than with the piece it
 * changed. The renderer is also listening for the broadcast, so a reply that
 * carried only a fragment would be a second shape to merge — and the two would
 * arrive in an order nobody controls.
 */
export function registerUpdateHandlers(updater: Updater): void {
  ipcMain.handle(UPDATE_CHANNELS.state, () => updater.current());

  ipcMain.handle(UPDATE_CHANNELS.check, () => updater.check());

  ipcMain.handle(UPDATE_CHANNELS.download, () => updater.download());
  ipcMain.handle(UPDATE_CHANNELS.openPage, () => updater.openPage());

  // Sent rather than invoked: the process is going away, so there is nothing
  // left to reply to.
  ipcMain.on(UPDATE_CHANNELS.install, () => updater.install());
  ipcMain.on(UPDATE_CHANNELS.dismiss, () => updater.dismiss());
}
