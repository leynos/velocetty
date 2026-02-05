/** @file Verifies updater wiring across event, timer, and config branches. */
import {expect, mock, test} from 'bun:test';

import {
  configureElectronMock,
  getElectronMock,
  registerElectronMock,
  resetElectronMock
} from '../testUtils/electron-path';

type UpdateEvent = 'update-available' | 'update-downloaded';
type UpdateEventPayload = Pick<Electron.Event, 'preventDefault'>;
type UpdateHandler = (
  event: UpdateEventPayload,
  releaseNotes: string,
  releaseName: string,
  releaseDate: Date,
  updateUrl?: string
) => void;
type ErrorHandler = (error: Error) => void;
type AutoUpdaterHandler = ErrorHandler | UpdateHandler;
type FeedUrlEntry = {url: string};
type ConfigSubscriber = () => Promise<void> | void;

type AutoUpdaterStub = {
  on: (event: 'error' | UpdateEvent, handler: AutoUpdaterHandler) => AutoUpdaterStub;
  removeListener: (event: UpdateEvent, handler: UpdateHandler) => AutoUpdaterStub;
  setFeedURL: (entry: FeedUrlEntry) => void;
  checkForUpdates: () => void;
  quitAndInstall: () => void;
};

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const buildAutoUpdaterStub = () => {
  const handlers: Partial<Record<'error' | UpdateEvent, AutoUpdaterHandler>> = {};
  const feedUrlCalls: FeedUrlEntry[] = [];
  const removedListeners: UpdateEvent[] = [];
  let checkForUpdatesCalls = 0;
  let quitAndInstallCalls = 0;

  const autoUpdater: AutoUpdaterStub = {
    on: (event, handler) => {
      handlers[event] = handler;
      return autoUpdater;
    },
    removeListener: (event) => {
      removedListeners.push(event);
      return autoUpdater;
    },
    setFeedURL: (entry) => {
      feedUrlCalls.push(entry);
    },
    checkForUpdates: () => {
      checkForUpdatesCalls += 1;
    },
    quitAndInstall: () => {
      quitAndInstallCalls += 1;
    }
  };

  return {
    autoUpdater,
    getUpdateEvent: () => (process.platform === 'linux' ? 'update-available' : 'update-downloaded'),
    getUpdateHandler: () =>
      handlers[process.platform === 'linux' ? 'update-available' : 'update-downloaded'] as UpdateHandler | undefined,
    getFeedUrlCalls: () => feedUrlCalls,
    getRemovedListeners: () => removedListeners,
    getCheckForUpdatesCalls: () => checkForUpdatesCalls,
    getQuitAndInstallCalls: () => quitAndInstallCalls
  };
};

const buildRpcStub = (emitCalls: Array<[string, Record<string, unknown>]>) => {
  const onceHandlers: Record<string, () => void> = {};
  return {
    emit: (event: string, payload: Record<string, unknown>) => {
      emitCalls.push([event, payload]);
    },
    once: (event: string, callback: () => void) => {
      onceHandlers[event] = callback;
    },
    triggerOnce: (event: string) => {
      onceHandlers[event]?.();
    }
  };
};

const buildWindowStub = (rpcStub: ReturnType<typeof buildRpcStub>) => {
  const handlers: Record<string, () => void> = {};
  return {
    rpc: rpcStub,
    on: (event: string, callback: () => void) => {
      handlers[event] = callback;
    },
    trigger: (event: string) => {
      handlers[event]?.();
    }
  };
};

const registerUpdaterMocks = (autoUpdater: AutoUpdaterStub, getDecoratedConfig: () => unknown) => {
  mock.module('../../app/auto-updater-linux', () => ({default: autoUpdater}));
  mock.module('../../app/config', () => ({getDefaultProfile: () => 'default'}));
  mock.module('../../app/plugins', () => ({
    getDecoratedConfig: () => getDecoratedConfig()
  }));
  mock.module('../../app/package.json', () => ({version: '0.0.0-test'}));
  mock.module('async-retry', () => ({
    default: async (fn: () => unknown) => await fn()
  }));
};

let importCounter = 0;
const loadUpdater = async () => {
  importCounter += 1;
  return await import(`../../app/updater.ts?coverage_case=${importCounter}`);
};

test.serial('updater wires lifecycle handlers, timers, and channel updates', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSetTimeout = globalThis.setTimeout;
  const originalSetInterval = globalThis.setInterval;
  const timeoutCallbacks: Array<() => void> = [];
  const intervalCallbacks: Array<() => void> = [];
  process.env.NODE_ENV = 'production';

  globalThis.setTimeout = ((callback: () => void) => {
    timeoutCallbacks.push(callback);
    return 1 as unknown as NodeJS.Timeout;
  }) as typeof globalThis.setTimeout;
  globalThis.setInterval = ((callback: () => void) => {
    intervalCallbacks.push(callback);
    return 1 as unknown as NodeJS.Timeout;
  }) as typeof globalThis.setInterval;

  try {
    const emitCalls: Array<[string, Record<string, unknown>]> = [];
    const {
      autoUpdater,
      getFeedUrlCalls,
      getUpdateHandler,
      getRemovedListeners,
      getCheckForUpdatesCalls,
      getQuitAndInstallCalls
    } = buildAutoUpdaterStub();
    const rpcStub = buildRpcStub(emitCalls);
    const winStub = buildWindowStub(rpcStub);
    let configSubscriber: ConfigSubscriber | null = null;
    const configState = {
      disableAutoUpdates: false,
      updateChannel: 'stable'
    };

    resetElectronMock();
    registerElectronMock();
    configureElectronMock({
      default: {autoUpdater}
    });
    const electronMock = getElectronMock();
    electronMock.app.runningUnderARM64Translation = false;
    electronMock.app.config = {
      subscribe: (callback: ConfigSubscriber) => {
        configSubscriber = callback;
      }
    };

    registerUpdaterMocks(autoUpdater, () => configState);

    const {default: updater} = await loadUpdater();
    updater(winStub as unknown as Electron.BrowserWindow);
    await settle();

    const updateHandler = getUpdateHandler();
    expect(updateHandler).toBeDefined();
    if (!updateHandler) {
      throw new Error('Expected update handler to be registered.');
    }
    updateHandler({preventDefault: () => {}}, 'notes', 'release', new Date('2020-01-01'), '');

    expect(emitCalls).toEqual([
      [
        'update available',
        {
          releaseNotes: 'notes',
          releaseName: 'release',
          releaseUrl: 'https://github.com/vercel/hyper/releases/tag/release',
          canInstall: process.platform !== 'linux'
        }
      ]
    ]);

    expect(timeoutCallbacks.length).toBe(1);
    expect(intervalCallbacks.length).toBe(1);
    timeoutCallbacks[0]();
    intervalCallbacks[0]();
    await settle();
    expect(getCheckForUpdatesCalls()).toBe(2);

    rpcStub.triggerOnce('quit and install');
    expect(getQuitAndInstallCalls()).toBe(1);

    expect(configSubscriber).toBeDefined();
    if (!configSubscriber) {
      throw new Error('Expected config subscriber callback to be registered.');
    }

    configState.updateChannel = 'canary';
    await configSubscriber();
    await settle();
    expect(getFeedUrlCalls().length >= 2).toBe(true);
    expect(getFeedUrlCalls().at(-1)?.url.includes('releases-canary.hyper.is')).toBe(true);

    winStub.trigger('close');
    expect(getRemovedListeners()).toEqual([process.platform === 'linux' ? 'update-available' : 'update-downloaded']);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.setInterval = originalSetInterval;
  }
});
