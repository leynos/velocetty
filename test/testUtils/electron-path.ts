/** @file Shared helpers for locating the app-scoped Electron entry. */

import {fileURLToPath} from 'node:url';

const appElectronPath = fileURLToPath(new URL('../../app/node_modules/electron/index.js', import.meta.url));

export const getAppElectronPath = () => appElectronPath;
