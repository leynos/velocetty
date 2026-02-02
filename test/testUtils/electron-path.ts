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
};

type ElectronMockOverrides = {
  default?: Partial<ElectronMock['default']>;
  app?: Partial<ElectronMock['app']>;
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
  }
};

let isRegistered = false;

/**
 * Returns the shared Electron mock instance.
 *
 * # Examples
 *
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
 * # Examples
 *
 * ```ts
 * resetElectronMock();
 * ```
 */
export const resetElectronMock = () => {
  delete electronMock.default.autoUpdater;
  electronMock.default.screen.getAllDisplays = () => [];
  electronMock.app.runningUnderARM64Translation = false;
  electronMock.app.config = {subscribe: () => {}};
};

/**
 * Applies targeted overrides to the Electron mock for a single test.
 *
 * # Examples
 *
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
};

/**
 * Registers the Electron mock for both module specifiers used in the app.
 *
 * # Examples
 *
 * ```ts
 * registerElectronMock();
 * ```
 */
export const registerElectronMock = () => {
  if (isRegistered) {
    return;
  }
  mock.module('electron', () => electronMock);
  mock.module(appElectronPath, () => electronMock);
  isRegistered = true;
};
