import {ipcRenderer as _ipc} from 'electron';

import type {IpcRendererWithCommands} from '@shared/types/common';

/** Electron's `ipcRenderer`, typed with the application's IPC command channels. */
export const ipcRenderer = _ipc as IpcRendererWithCommands;
