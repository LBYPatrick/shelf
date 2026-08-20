import { readFile, writeFile } from 'node:fs/promises';
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

  /*
   * Picking a file and reading it are one operation here, because the renderer
   * has no filesystem to read the path with. Settings and connection documents
   * are a few kilobytes; the thing that can be arbitrarily large is table data,
   * and that streams through the host instead.
   */
  ipcMain.handle(DIALOG_CHANNELS.readTextFile, async (event, options: OpenOptions) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const filters = fileFilters(options.extensions);

    const settings: Electron.OpenDialogOptions = {
      ...(options.title ? { title: options.title } : {}),
      properties: ['openFile'],
      ...(filters ? { filters } : {}),
    };

    const result = await (window
      ? dialog.showOpenDialog(window, settings)
      : dialog.showOpenDialog(settings));

    const path = result.canceled ? undefined : result.filePaths[0];
    if (!path) return undefined;
    return { path, text: await readFile(path, 'utf8') };
  });

  ipcMain.handle(
    DIALOG_CHANNELS.writeTextFile,
    async (event, options: SaveOptions, text: string) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const filters = fileFilters(options.extensions);

      const settings: Electron.SaveDialogOptions = {
        ...(options.title ? { title: options.title } : {}),
        ...(options.defaultPath ? { defaultPath: options.defaultPath } : {}),
        ...(filters ? { filters } : {}),
      };

      const result = await (window
        ? dialog.showSaveDialog(window, settings)
        : dialog.showSaveDialog(settings));

      if (result.canceled || !result.filePath) return undefined;
      await writeFile(result.filePath, text, 'utf8');
      return result.filePath;
    }
  );

  // The same dialog, decoded rather than written through: see `writeBinaryFile`
  // in the contract for why the renderer sends base64 and not bytes.
  ipcMain.handle(
    DIALOG_CHANNELS.writeBinaryFile,
    async (event, options: SaveOptions, base64: string) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const filters = fileFilters(options.extensions);

      const settings: Electron.SaveDialogOptions = {
        ...(options.title ? { title: options.title } : {}),
        ...(options.defaultPath ? { defaultPath: options.defaultPath } : {}),
        ...(filters ? { filters } : {}),
      };

      const result = await (window
        ? dialog.showSaveDialog(window, settings)
        : dialog.showSaveDialog(settings));

      if (result.canceled || !result.filePath) return undefined;
      await writeFile(result.filePath, Buffer.from(base64, 'base64'));
      return result.filePath;
    }
  );
}

function fileFilters(
  extensions: readonly string[] | undefined
): Electron.FileFilter[] | undefined {
  if (!extensions?.length) return undefined;
  return [
    {
      name: extensions.map((extension) => extension.toUpperCase()).join(' / '),
      extensions: [...extensions],
    },
    { name: 'All files', extensions: ['*'] },
  ];
}
