/** @file Verifies updater wiring across event, timer, and config branches. */
import {expect, test} from 'bun:test';
import type {JsonObject} from '@shared/types/json';
import type {configOptions} from '@shared/types/config';
import type {UpdaterWindow} from '../../app/updater';

import {
  configureElectronMock,
  getElectronMock,
  registerElectronMock,
  resetElectronMock
} from '../testUtils/electron-path';
import {registerModuleMock} from '../testUtils/mock-module';

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

/**
 * Two microtask ticks flush the async chain used by updater init/subscription
 * paths in this suite.
 */
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const createSchedulerSeam = () => {
  const timeoutCallbacks: Array<() => void> = [];
  const intervalCallbacks: Array<() => void> = [];
  let nextTimerId = 0;

  return {
    timeoutCallbacks,
    intervalCallbacks,
    scheduler: {
      setTimeout: (callback: () => void) => {
        nextTimerId += 1;
        timeoutCallbacks.push(callback);
        return nextTimerId;
      },
      setInterval: (callback: () => void) => {
        nextTimerId += 1;
        intervalCallbacks.push(callback);
        return nextTimerId;
      }
    }
  };
};

const createLoggerSeam = () => {
  const errorCalls: unknown[][] = [];
  return {
    errorCalls,
    logger: {
      error: (...args: unknown[]) => {
        errorCalls.push(args);
      }
    }
  };
};

const buildAutoUpdaterStub = () => {
  // Updater currently registers one handler per event type in this test target.
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
    getUpdateHandler: () => {
      const event = process.platform === 'linux' ? 'update-available' : 'update-downloaded';
      // SAFETY: The updater registers UpdateHandler values for these two event names; the error slot is separate.
      return handlers[event] as UpdateHandler | undefined;
    },
    getFeedUrlCalls: () => feedUrlCalls,
    getRemovedListeners: () => removedListeners,
    getCheckForUpdatesCalls: () => checkForUpdatesCalls,
    getQuitAndInstallCalls: () => quitAndInstallCalls,
    getErrorHandler: () => {
      // SAFETY: The updater registers only ErrorHandler values under the dedicated error event name.
      return handlers.error as ErrorHandler | undefined;
    }
  };
};

const buildRpcStub = (emitCalls: Array<[string, JsonObject]>) => {
  const onceHandlers: Record<string, () => void> = {};
  return {
    emit: (event: 'update available', payload: Parameters<UpdaterWindow['rpc']['emit']>[1]) => {
      emitCalls.push([event, payload]);
      return true;
    },
    once: (event: 'quit and install', callback: () => void) => {
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

/**
 * A faithful double for `app/package.json`.
 *
 * Bun keeps one mock registry for the whole test process, so this registration
 * outlives the suite. A stub carrying only the export this file happens to read
 * is not a mock of the module: `app/index.mts` default-imports the metadata
 * object, and every other consumer reads named fields. Supplying both shapes
 * means whichever module imports it next gets what its real counterpart exports.
 */
const packageMetadata = {productName: 'Hyper', version: '0.0.0-test'};

const registerUpdaterMocks = (
  autoUpdater: AutoUpdaterStub,
  getDecoratedConfig: () => Pick<configOptions, 'disableAutoUpdates' | 'updateChannel'>
) => {
  registerModuleMock('../../app/auto-updater-linux', () => ({default: autoUpdater}));
  registerModuleMock('../../app/config', () => ({getDefaultProfile: () => 'default'}));
  registerModuleMock('../../app/plugins', () => ({
    getDecoratedConfig: () => getDecoratedConfig()
  }));
  registerModuleMock('../../app/package.json', () => ({
    ...packageMetadata,
    default: packageMetadata
  }));
  registerModuleMock('async-retry', () => ({
    default: async <Result>(fn: () => Result | Promise<Result>): Promise<Result> => await fn()
  }));
};

let importCounter = 0;
const loadUpdater = async () => {
  importCounter += 1;
  // Query parameter ensures Bun does not reuse cached module state across tests.
  return await import(`../../app/updater.ts?coverage_case=${importCounter}`);
};

test.serial('updater wires lifecycle handlers, timers, and channel updates', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const {scheduler, timeoutCallbacks, intervalCallbacks} = createSchedulerSeam();
  process.env.NODE_ENV = 'production';

  try {
    const emitCalls: Array<[string, JsonObject]> = [];
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
    // `subscribe` runs inside the updater, so the callback is captured into a
    // list rather than a local: control-flow narrowing would otherwise keep
    // the local at its `null` initializer.
    const configSubscribers: ConfigSubscriber[] = [];
    // Typed as the slice the updater reads so assigning `'canary'` below stays
    // inside the `updateChannel` union instead of widening to `string`.
    const configState: Pick<configOptions, 'disableAutoUpdates' | 'updateChannel'> = {
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
        configSubscribers.push(callback);
      }
    };

    registerUpdaterMocks(autoUpdater, () => configState);

    const {default: updater} = await loadUpdater();
    updater(winStub, {scheduler});
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

    expect(timeoutCallbacks).toHaveLength(1);
    expect(intervalCallbacks).toHaveLength(1);
    timeoutCallbacks[0]();
    intervalCallbacks[0]();
    await settle();
    expect(getCheckForUpdatesCalls()).toBe(2);

    rpcStub.triggerOnce('quit and install');
    expect(getQuitAndInstallCalls()).toBe(1);

    // The updater registers exactly one config listener; the length assertion
    // states that, and the destructure below then reads it without a guard the
    // compiler would already call dead.
    expect(configSubscribers).toHaveLength(1);
    const [configSubscriber] = configSubscribers;

    configState.updateChannel = 'canary';
    await configSubscriber();
    await settle();
    expect(getFeedUrlCalls().length).toBeGreaterThanOrEqual(2);
    expect(getFeedUrlCalls().at(-1)?.url).toContain('releases-canary.hyper.is');

    winStub.trigger('close');
    expect(getRemovedListeners()).toEqual([process.platform === 'linux' ? 'update-available' : 'update-downloaded']);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

test.serial('updater honours disableAutoUpdates and handles updater error events', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const {scheduler, timeoutCallbacks, intervalCallbacks} = createSchedulerSeam();
  const {logger, errorCalls} = createLoggerSeam();
  process.env.NODE_ENV = 'production';

  try {
    const emitCalls: Array<[string, JsonObject]> = [];
    const {autoUpdater, getCheckForUpdatesCalls, getErrorHandler} = buildAutoUpdaterStub();
    const rpcStub = buildRpcStub(emitCalls);
    const winStub = buildWindowStub(rpcStub);
    const configState: Pick<configOptions, 'disableAutoUpdates' | 'updateChannel'> = {
      disableAutoUpdates: true,
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
      subscribe: () => {}
    };

    registerUpdaterMocks(autoUpdater, () => configState);
    const {default: updater} = await loadUpdater();
    updater(winStub, {scheduler, logger});
    await settle();

    expect(timeoutCallbacks).toHaveLength(1);
    expect(intervalCallbacks).toHaveLength(1);

    timeoutCallbacks[0]();
    intervalCallbacks[0]();
    await settle();

    expect(getCheckForUpdatesCalls()).toBe(0);
    expect(emitCalls).toHaveLength(0);

    const errorHandler = getErrorHandler();
    expect(errorHandler).toBeDefined();
    if (!errorHandler) {
      throw new Error('Expected updater error handler to be registered.');
    }
    const error = new Error('simulated updater error');
    errorHandler(error);
    expect(errorCalls).toHaveLength(1);
    expect(String(errorCalls[0][0])).toContain('Error fetching updates');
    expect(String(errorCalls[0][1])).toContain('simulated updater error');
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
  }
});
