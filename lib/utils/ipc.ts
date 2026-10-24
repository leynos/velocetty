import * as electron from 'electron';

import type {IpcRendererWithCommands} from '@shared/types/common';

// SAFETY: Electron's ipcRenderer implements invoke; this type adds the repository's command map.
export const ipcRenderer = electron.ipcRenderer as IpcRendererWithCommands;
