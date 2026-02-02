/** @file Shared helpers for locating and mocking Electron in tests. */

import {fileURLToPath} from 'node:url';

import {mock} from 'bun:test';

const appElectronPath = fileURLToPath(new URL('../../app/node_modules/electron/index.js', import.meta.url));

export const getAppElectronPath = () => appElectronPath;

export const mockElectronModule = (factory: () => Record<string, unknown>) => {
  mock.module('electron', factory);
  mock.module(appElectronPath, factory);
};
