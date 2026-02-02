/** @file Verifies updater wiring for autoUpdater events. */
import {expect, mock, test} from 'bun:test';

import {configureElectronMock, registerElectronMock, resetElectronMock} from '../testUtils/electron-path';

/** Update lifecycle events that trigger renderer notifications. */
type UpdateEvent = 'update-available' | 'update-downloaded';
/** AutoUpdater event payload subset used by this test. */
type UpdateEventPayload = Pick<Electron.Event, 'preventDefault'>;
/** Handler signature for update event callbacks. */
type UpdateHandler = (
  event: UpdateEventPayload,
  releaseNotes: string,
  releaseName: string,
  releaseDate: Date,
  updateUrl?: string
) => void;
/** Handler signature for autoUpdater error callbacks. */
type ErrorHandler = (error: Error) => void;
/** Argument tuple variants supported by the autoUpdater on() stub. */
type AutoUpdaterOnArgs = ['error', ErrorHandler] | [UpdateEvent, UpdateHandler];
/** Minimal autoUpdater surface needed by the updater wiring test. */
type AutoUpdaterStub = {
  on: (...args: AutoUpdaterOnArgs) => AutoUpdaterStub;
  removeListener: () => AutoUpdaterStub;
  setFeedURL: () => void;
  checkForUpdates: () => void;
  quitAndInstall: () => void;
};

const buildAutoUpdaterStub = () => {
  let updateEvent: UpdateEvent | null = null;
  let updateHandler: UpdateHandler | null = null;
  const autoUpdater: AutoUpdaterStub = {
    on: (...args) => {
      if (args[0] === 'error') {
        return autoUpdater;
      }
      const [event, handler] = args as [UpdateEvent, UpdateHandler];
      updateEvent = event;
      updateHandler = handler;
      return autoUpdater;
    },
    removeListener: () => autoUpdater,
    setFeedURL: () => {},
    checkForUpdates: () => {},
    quitAndInstall: () => {}
  };

  return {
    autoUpdater,
    getUpdateEvent: () => updateEvent,
    getUpdateHandler: () => updateHandler
  };
};

const buildAppStub = () => ({
  runningUnderARM64Translation: false,
  config: {subscribe: () => {}}
});

const buildRpcStub = (emitCalls: Array<[string, Record<string, unknown>]>) => ({
  emit: (event: string, payload: Record<string, unknown>) => {
    emitCalls.push([event, payload]);
  },
  once: () => {}
});

const buildWindowStub = (rpcStub: ReturnType<typeof buildRpcStub>) => ({
  rpc: rpcStub,
  on: () => {}
});

const registerUpdaterMocks = (autoUpdater: AutoUpdaterStub) => {
  mock.module('../../app/auto-updater-linux', () => ({default: autoUpdater}));
  mock.module('../../app/config', () => ({getDefaultProfile: () => 'default'}));
  mock.module('../../app/plugins', () => ({
    getDecoratedConfig: () => ({disableAutoUpdates: true, updateChannel: 'stable'})
  }));
  mock.module('../../app/package.json', () => ({version: '0.0.0-test'}));
  mock.module('async-retry', () => ({
    default: async (fn: () => unknown) => await fn()
  }));
};

/**
 * Runs serially because it mutates shared module state (NODE_ENV and mocks).
 */
test.serial('updater wires update handlers and emits', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';

  try {
    const emitCalls: Array<[string, Record<string, unknown>]> = [];
    const {autoUpdater, getUpdateEvent, getUpdateHandler} = buildAutoUpdaterStub();
    const appStub = buildAppStub();
    const rpcStub = buildRpcStub(emitCalls);
    const winStub = buildWindowStub(rpcStub);

    resetElectronMock();
    registerElectronMock();
    configureElectronMock({
      default: {autoUpdater},
      app: {
        runningUnderARM64Translation: appStub.runningUnderARM64Translation,
        config: appStub.config
      }
    });

    registerUpdaterMocks(autoUpdater);

    const {default: updater} = await import('../../app/updater');

    updater(winStub);

    const updateEvent = getUpdateEvent();
    if (updateEvent == null) {
      throw new Error('Expected update event to be registered.');
    }

    const updateHandler = getUpdateHandler();
    if (updateHandler == null) {
      throw new Error('Expected update handler to be registered.');
    }

    const registeredEvent: UpdateEvent = updateEvent;
    const registeredHandler: UpdateHandler = updateHandler;

    const expectedEvent: UpdateEvent = process.platform === 'linux' ? 'update-available' : 'update-downloaded';
    expect(registeredEvent).toBe(expectedEvent);

    const updateEventPayload: UpdateEventPayload = {preventDefault: () => {}};
    registeredHandler(updateEventPayload, 'notes', 'release', new Date('2020-01-01'), '');

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
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
  }
});
