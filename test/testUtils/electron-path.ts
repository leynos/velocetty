/** @file Shared helpers for locating and mocking Electron in tests. */

import {realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

import {mock} from 'bun:test';

const appEntryPath = fileURLToPath(new URL('../../app/updater.ts', import.meta.url));
const appRequire = createRequire(appEntryPath);
const appElectronPath = realpathSync(appRequire.resolve('electron'));

type ElectronMock = {
  default: {
    autoUpdater?: unknown;
    screen: {
      getAllDisplays: () => unknown[];
    };
  };
  app: Record<string, unknown>;
};

const electronMock: ElectronMock = {
  default: {
    screen: {
      getAllDisplays: () => []
    }
  },
  app: {}
};

let isRegistered = false;

export const getElectronMock = () => electronMock;

export const registerElectronMock = () => {
  if (isRegistered) {
    return;
  }
  mock.module('electron', () => electronMock);
  mock.module(appElectronPath, () => electronMock);
  isRegistered = true;
};
