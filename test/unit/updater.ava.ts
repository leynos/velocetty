/** @file Verifies updater wiring for autoUpdater events. */
import test from 'ava';

const proxyquire = require('proxyquire').noCallThru();

test.serial('updater wires update handlers and emits', async (t) => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';

  t.teardown(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  const emitCalls: Array<[string, Record<string, unknown>]> = [];
  let updateEvent: string | null = null;
  let updateHandler: ((...args: unknown[]) => void) | null = null;

  const autoUpdater = {
    on: (event: string, handler: (...args: unknown[]) => void) => {
      if (event !== 'error') {
        updateEvent = event;
        updateHandler = handler;
      }
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

  const expectedEvent = process.platform === 'linux' ? 'update-available' : 'update-downloaded';
  t.is(updateEvent, expectedEvent);
  t.truthy(updateHandler);

  updateHandler?.({} as Electron.Event, 'notes', 'release', new Date('2020-01-01'), '');

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
