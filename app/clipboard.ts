/** @file Registers privileged clipboard commands used by the renderer. */
import {clipboard, ipcMain as _ipcMain} from 'electron';

import type {IpcMainWithCommands} from '@shared/types/common';

import {readClipboardFilePaths} from './utils/clipboard-paths';

const ipcMain = _ipcMain as IpcMainWithCommands;

/**
 * Registers clipboard IPC handlers.
 *
 * Electron 44 removed the renderer `clipboard` module (RFC 0019), so terminal
 * paste and quick-edit copy route through these main-process handlers.
 *
 * Example:
 * - `registerClipboardIpcHandlers()` makes `transport.invoke('clipboard.readFilePaths')`
 *   available to every renderer.
 */
export const registerClipboardIpcHandlers = () => {
  ipcMain.handle('clipboard.readFilePaths', () => readClipboardFilePaths(clipboard));
  ipcMain.handle('clipboard.readText', () => clipboard.readText());
  ipcMain.handle('clipboard.writeText', (_event, text) => clipboard.writeText(text));
};
