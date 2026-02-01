/** @file Verifies updater wiring for autoUpdater events. */
import test from 'ava';

const proxyquire = require('proxyquire').noCallThru();

test.serial('updater wires update handlers and emits', async (t) => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';

  t.teardown(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

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

  const emitCalls: Array<[string, Record<string, unknown>]> = [];
  let updateEvent: UpdateEvent | null = null;
  let updateHandler: UpdateHandler | null = null;

  type AutoUpdaterOnArgs = ['error', ErrorHandler] | [UpdateEvent, UpdateHandler];

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
      const [event, handler] = args;
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

  const updater = proxyquire('../../app/updater', {
    electron: {
      autoUpdater,
      app: appStub
    },
    './auto-updater-linux': autoUpdater,
    './config': {
      getDefaultProfile: () => 'default'
    },
    './plugins': {
      getDecoratedConfig: () => ({disableAutoUpdates: true, updateChannel: 'stable'})
    },
    './package.json': {
      version: '0.0.0-test'
    },
    'async-retry': async (fn: () => unknown) => await fn()
  }).default;

  updater(winStub);

  const registeredEvent: UpdateEvent = updateEvent ?? t.fail('Expected update event to be registered.');
  const registeredHandler: UpdateHandler = updateHandler ?? t.fail('Expected update handler to be registered.');

  const expectedEvent: UpdateEvent = process.platform === 'linux' ? 'update-available' : 'update-downloaded';
  t.true(registeredEvent === expectedEvent);

  const updateEventPayload: UpdateEventPayload = {preventDefault: () => {}};
  registeredHandler(updateEventPayload, 'notes', 'release', new Date('2020-01-01'), '');

  t.deepEqual(emitCalls, [
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
});
