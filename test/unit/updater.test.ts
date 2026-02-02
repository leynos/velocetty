/** @file Verifies updater wiring for autoUpdater events. */
import {expect, mock, test} from 'bun:test';

import {getElectronMock, registerElectronMock} from '../testUtils/electron-path';

test.serial('updater wires update handlers and emits', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';

  try {
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

    const emitCalls: Array<[string, Record<string, unknown>]> = [];
    let updateEvent: UpdateEvent | null = null;
    let updateHandler: UpdateHandler | null = null;

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

    const autoUpdater: AutoUpdaterStub = {
      on: (...args) => {
        if (args[0] === 'error') {
          return autoUpdater;
        }
        const updateArgs = args as [UpdateEvent, UpdateHandler];
        const [event, handler] = updateArgs;
        updateEvent = event;
        updateHandler = handler;
        return autoUpdater;
      },
      removeListener: () => autoUpdater,
      setFeedURL: () => {},
      checkForUpdates: () => {},
      quitAndInstall: () => {}
    };

    const appStub = {
      runningUnderARM64Translation: false,
      config: {subscribe: () => {}}
    };

    const rpcStub = {
      emit: (event: string, payload: Record<string, unknown>) => {
        emitCalls.push([event, payload]);
      },
      once: () => {}
    };

    const winStub = {
      rpc: rpcStub,
      on: () => {}
    };

    registerElectronMock();
    const electronMock = getElectronMock();
    electronMock.default.autoUpdater = autoUpdater;
    electronMock.app.runningUnderARM64Translation = appStub.runningUnderARM64Translation;
    electronMock.app.config = appStub.config;

    mock.module('../../app/auto-updater-linux', () => ({default: autoUpdater}));
    mock.module('../../app/config', () => ({getDefaultProfile: () => 'default'}));
    mock.module('../../app/plugins', () => ({
      getDecoratedConfig: () => ({disableAutoUpdates: true, updateChannel: 'stable'})
    }));
    mock.module('../../app/package.json', () => ({version: '0.0.0-test'}));
    mock.module('async-retry', () => ({
      default: async (fn: () => unknown) => await fn()
    }));

    const {default: updater} = await import('../../app/updater');

    updater(winStub);

    if (updateEvent == null) {
      throw new Error('Expected update event to be registered.');
    }

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
