import { BrowserWindow, dialog, ipcMain } from 'electron';
import { DIALOG_CHANNELS } from '@shared/window';

interface OpenOptions {
  title?: string;
  extensions?: readonly string[];
  /** Offer a path that does not exist yet, for creating a new database file. */
  allowCreate?: boolean;
}

interface SaveOptions {
  title?: string;
  defaultPath?: string;
  extensions?: readonly string[];
}

/** Native file pickers, for the engines that connect to a file. */
export function registerDialogHandlers(): void {
  ipcMain.handle(DIALOG_CHANNELS.openFile, async (event, options: OpenOptions) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const filters = options.extensions?.length
      ? [
          { name: 'Databases', extensions: [...options.extensions] },
          { name: 'All files', extensions: ['*'] },
        ]
      : undefined;

    const properties: Array<'openFile' | 'createDirectory' | 'promptToCreate'> = ['openFile'];
    if (options.allowCreate) properties.push('promptToCreate');

    const result = await (window
      ? dialog.showOpenDialog(window, {
          ...(options.title ? { title: options.title } : {}),
          properties,
          ...(filters ? { filters } : {}),
        })
      : dialog.showOpenDialog({ properties, ...(filters ? { filters } : {}) }));

    return result.canceled ? undefined : result.filePaths[0];
  });

  ipcMain.handle(DIALOG_CHANNELS.saveFile, async (event, options: SaveOptions) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const filters = options.extensions?.length
      ? [{ name: 'Files', extensions: [...options.extensions] }]
      : undefined;

    const result = await (window
      ? dialog.showSaveDialog(window, {
          ...(options.title ? { title: options.title } : {}),
          ...(options.defaultPath ? { defaultPath: options.defaultPath } : {}),
          ...(filters ? { filters } : {}),
        })
      : dialog.showSaveDialog({ ...(filters ? { filters } : {}) }));

    return result.canceled ? undefined : result.filePath;
  });
}
