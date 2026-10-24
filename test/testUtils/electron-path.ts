/**
 * @file Shared helpers for locating and mocking Electron in tests.
 * Purpose: Provide a single, consistent mock for Electron modules across tests.
 * Usage: Call registerElectronMock() before importing Electron-dependent
 * modules, then configure or reset the mock per suite as needed.
 */

import {realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

import {registerModuleMock} from './mock-module';
import type {ClipboardBookmark, IpcMainEvent} from 'electron';

// Resolve Electron relative to app code; updater.ts is a stable entry used by
// multiple tests and mirrors runtime dependency resolution.
const appEntryPath = fileURLToPath(new URL('../../app/updater.ts', import.meta.url));
const appRequire = createRequire(appEntryPath);
const appElectronPath = realpathSync(appRequire.resolve('electron'));

/** Callback shape the app registers with `app.config.subscribe`. */
type ConfigSubscriber = () => void | Promise<void>;

/**
 * Listener shape Electron's `ipcMain` accepts.
 *
 * Declared with Electron's own event type and an `any[]` tail rather than an
 * `unknown[]` one: `unknown` parameters are contravariant here, so a mock whose
 * listener takes `IpcMainEvent` would be rejected by a slot that could call it
 * with anything.
 */
type IpcMainEventListener = (event: IpcMainEvent, ...args: any[]) => void;

/**
 * Handler shape `ipcMain.handle` accepts.
 *
 * Electron declares this slot as `(event, ...args) => Promise<any> | any`, and
 * the reply type genuinely varies per channel: `clipboard.readFilePaths` yields a
 * `string[]`, `clipboard.readText` a `string`, and `clipboard.writeText` nothing.
 * Mirroring Electron's own signature keeps the mock assignable from each real
 * handler without naming a type the declaration does not have.
 */
export type IpcHandleListener = (event: IpcMainEvent, ...args: any[]) => any;

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
    getAppPath: () => string;
    getPath: (name: string) => string;
    quit: () => void;
    runningUnderARM64Translation?: boolean;
    config: {
      subscribe: (callback: ConfigSubscriber) => void;
    };
  };
  ipcMain: {
    on: (channel: string, listener: IpcMainEventListener) => void;
    removeListener: (channel: string, listener: IpcMainEventListener) => void;
    handle: (channel: string, handler: IpcHandleListener) => void;
  };
  clipboard?: ClipboardMock;
};

/**
 * A payload Electron hands back for one clipboard MIME type.
 *
 * Electron types `ClipboardItem.getType` as `Promise<Blob> |
 * Promise<ClipboardBookmark>`, and its constructor additionally accepts a plain
 * `string` for a text type. All three reach the adapter at runtime, and the
 * adapter's guard is what decides which it will decode — so the union is the
 * honest fixture type rather than a loosened one.
 */
export type ClipboardTypePayload = Blob | ClipboardBookmark | string;

/** One clipboard entry as Electron reports it to the main process. */
export type ClipboardItemMock = {
  types: string[];
  getType: (type: string) => Promise<ClipboardTypePayload>;
};

/** The slice of Electron's `clipboard` module the app reads. */
export type ClipboardMock = {
  read: () => Promise<ClipboardItemMock[]>;
  readText: () => string;
  writeText: (text: string) => void;
};

type ElectronMockOverrides = {
  default?: Partial<ElectronMock['default']>;
  app?: Partial<ElectronMock['app']>;
  ipcMain?: Partial<ElectronMock['ipcMain']>;
  clipboard?: ClipboardMock;
};

const electronMock: ElectronMock = {
  default: {
    screen: {
      getAllDisplays: () => []
    }
  },
  app: {
    getAppPath: () => '/tmp/velocetty-app',
    getPath: (_name: string) => '/tmp/velocetty-electron-user-data',
    quit: () => {},
    runningUnderARM64Translation: false,
    config: {subscribe: () => {}}
  },
  ipcMain: {
    on: () => {},
    removeListener: () => {},
    handle: () => {}
  },
  clipboard: {
    read: async () => [],
    readText: () => '',
    writeText: () => {}
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
  electronMock.app.getAppPath = () => '/tmp/velocetty-app';
  electronMock.app.getPath = (_name: string) => '/tmp/velocetty-electron-user-data';
  electronMock.app.quit = () => {};
  electronMock.app.runningUnderARM64Translation = false;
  electronMock.app.config = {subscribe: () => {}};
  electronMock.ipcMain.on = () => {};
  electronMock.ipcMain.removeListener = () => {};
  electronMock.ipcMain.handle = () => {};
  electronMock.clipboard = {
    read: async () => [],
    readText: () => '',
    writeText: () => {}
  };
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
  if (overrides.clipboard) {
    electronMock.clipboard = overrides.clipboard;
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
  registerModuleMock('electron', () => electronMock);
  registerModuleMock(appElectronPath, () => electronMock);
};
