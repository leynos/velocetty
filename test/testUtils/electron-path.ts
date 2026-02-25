/**
 * @file Shared helpers for locating and mocking Electron in tests.
 * Purpose: Provide a single, consistent mock for Electron modules across tests.
 * Usage: Call registerElectronMock() before importing Electron-dependent
 * modules, then configure or reset the mock per suite as needed.
 */

import {realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

import {mock} from 'bun:test';

// Resolve Electron relative to app code; updater.ts is a stable entry used by
// multiple tests and mirrors runtime dependency resolution.
const appEntryPath = fileURLToPath(new URL('../../app/updater.ts', import.meta.url));
const appRequire = createRequire(appEntryPath);
const appElectronPath = realpathSync(appRequire.resolve('electron'));

/**
 * Minimal Electron module surface used by tests.
 */
type ElectronMock = {
  default: {
    autoUpdater?: unknown;
    screen: {
      getAllDisplays: () => unknown[];
    };
  };
  app: {
    runningUnderARM64Translation?: boolean;
    config?: {subscribe?: () => void};
  };
  ipcMain: {
    on: (..._args: unknown[]) => void;
    removeListener: (..._args: unknown[]) => void;
  };
};

type ElectronMockOverrides = {
  default?: Partial<ElectronMock['default']>;
  app?: Partial<ElectronMock['app']>;
  ipcMain?: Partial<ElectronMock['ipcMain']>;
};

const electronMock: ElectronMock = {
  default: {
    screen: {
      getAllDisplays: () => []
    }
  },
  app: {
    runningUnderARM64Translation: false,
    config: {subscribe: () => {}}
  },
  ipcMain: {
    on: () => {},
    removeListener: () => {}
  }
};

/**
 * Returns the shared Electron mock instance.
 *
 * @example
 * ```ts
 * registerElectronMock();
 * const electronMock = getElectronMock();
 * electronMock.default.screen.getAllDisplays = () => [];
 * ```
 */
export const getElectronMock = () => electronMock;

/**
 * Restores the Electron mock to its default state.
 *
 * @example
 * ```ts
 * resetElectronMock();
 * ```
 */
export const resetElectronMock = () => {
  delete electronMock.default.autoUpdater;
  electronMock.default.screen.getAllDisplays = () => [];
  electronMock.app.runningUnderARM64Translation = false;
  electronMock.app.config = {subscribe: () => {}};
  electronMock.ipcMain.on = () => {};
  electronMock.ipcMain.removeListener = () => {};
};

/**
 * Applies targeted overrides to the Electron mock for a single test.
 *
 * @example
 * ```ts
 * configureElectronMock({
 *   app: {runningUnderARM64Translation: true}
 * });
 * ```
 */
export const configureElectronMock = (overrides: ElectronMockOverrides) => {
  if (overrides.default?.autoUpdater !== undefined) {
    electronMock.default.autoUpdater = overrides.default.autoUpdater;
  }
  if (overrides.default?.screen) {
    electronMock.default.screen = overrides.default.screen;
  }
  if (overrides.app) {
    electronMock.app = {
      ...electronMock.app,
      ...overrides.app
    };
  }
  if (overrides.ipcMain) {
    electronMock.ipcMain = {
      ...electronMock.ipcMain,
      ...overrides.ipcMain
    };
  }
};

/**
 * Registers the Electron mock for both module specifiers used in the app
 * (`electron` and the app-resolved `appElectronPath`).
 * Safe to call repeatedly so suites can recover after `mock.restore()` in
 * other files resets module mocks in the same Bun process.
 *
 * @example
 * ```ts
 * registerElectronMock();
 * ```
 */
export const registerElectronMock = () => {
  mock.module('electron', () => electronMock);
  mock.module(appElectronPath, () => electronMock);
};
