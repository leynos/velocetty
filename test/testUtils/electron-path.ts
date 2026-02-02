/** @file Shared helpers for locating and mocking Electron in tests. */

import {realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

import {mock} from 'bun:test';

const appEntryPath = fileURLToPath(new URL('../../app/updater.ts', import.meta.url));
const appRequire = createRequire(appEntryPath);
const appElectronPath = realpathSync(appRequire.resolve('electron'));

export const getAppElectronPath = () => appElectronPath;

export const mockElectronModule = (factory: () => Record<string, unknown>) => {
  mock.module('electron', factory);
  mock.module(appElectronPath, factory);
};
