/** @file Registers privileged clipboard commands used by the renderer. */
import {clipboard, ipcMain as _ipcMain} from 'electron';
import type {ClipboardItem} from 'electron';

import type {IpcMainWithCommands} from '@shared/types/common';
import {isString} from './utils/runtime-guards';

import {readClipboardFilePaths} from './utils/clipboard-paths';
import type {ClipboardItemPort, ClipboardPort, ClipboardPayload} from './utils/clipboard-paths';

// SAFETY: `IpcMain` gained the channel-typed `handle` overload used here; the
// runtime object is Electron's IPC main process handle.
const ipcMain = _ipcMain as IpcMainWithCommands;

/**
 * Narrows an Electron clipboard type payload to the shapes the port can read.
 *
 * `getType` is typed as returning `unknown` because Electron hands back a
 * different runtime representation per MIME type: a `Blob` for the URI-list
 * type, a bookmark object for `electron application/bookmark`. This guard is
 * the single place that decides which of those the port accepts.
 */
const isClipboardPayload = (payload: unknown): payload is ClipboardPayload =>
  payload instanceof Blob || isString(payload);

/**
 * Reads one MIME type from an Electron clipboard entry.
 *
 * Reporting unreadable payloads as `null` keeps the port honest, so the caller
 * only ever sees payloads it can decode.
 */
const readClipboardItemType = async (item: ClipboardItem, type: string): Promise<ClipboardPayload | null> => {
  const payload = await item.getType(type);
  return isClipboardPayload(payload) ? payload : null;
};

/**
 * Adapts Electron's `clipboard` to the narrow port the parser consumes.
 *
 * Desktop clipboard contents are an untrusted boundary: the adapter validates
 * every entry against the port's payload contract so no `unknown` value
 * reaches the path parser.
 */
const clipboardPort: ClipboardPort = {
  read: async (): Promise<readonly ClipboardItemPort[]> =>
    clipboard.read().then((items) =>
      items.map((item) => ({
        types: item.types,
        getType: (type: string) => readClipboardItemType(item, type)
      }))
    )
};

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
  ipcMain.handle('clipboard.readFilePaths', () => readClipboardFilePaths(clipboardPort));
  ipcMain.handle('clipboard.readText', () => clipboard.readText());
  ipcMain.handle('clipboard.writeText', (_event, text) => clipboard.writeText(text));
};
