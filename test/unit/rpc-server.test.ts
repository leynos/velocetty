/** @file Verifies main-process RPC server lifecycle and IPC routing. */
import {EventEmitter} from 'node:events';

import {afterEach, beforeAll, beforeEach, expect, mock, test} from 'bun:test';

import {asCommandId} from '@shared/types/commands';

import {getElectronMock, registerElectronMock, resetElectronMock} from '../testUtils/electron-path';
import {importFresh} from '../testUtils/import-fresh';
import {registerModuleMock} from '../testUtils/mock-module';

type IpcMainListener = (event: Electron.IpcMainEvent, payload: {ev: string; data?: unknown}) => void;
// SAFETY: Server.ipcListener ignores the event object in this harness; the test exercises only its payload routing.
const unusedIpcMainEvent = {} as Electron.IpcMainEvent;

const ipcMainOnMock = mock((_channel: string, _listener: IpcMainListener) => {});
const ipcMainRemoveListenerMock = mock((_channel: string, _listener: IpcMainListener) => {});

registerModuleMock('uuid', () => ({
  v4: () => 'test-rpc-id'
}));

// eslint-disable-next-line unicorn/prefer-event-target -- The Electron WebContents fixture must preserve EventEmitter's `emit` behavior.
class FakeWebContents extends EventEmitter {
  send = mock((..._args: unknown[]) => {});
  removeAllListeners = mock(() => super.removeAllListeners());
}

const createWindowStub = () => {
  const webContents = new FakeWebContents();
  let isDestroyed = false;

  const win = {
    profileName: 'default-profile',
    webContents,
    isDestroyed: () => isDestroyed,
    // The server only forwards the two full-screen transitions; no test drives
    // them here, so the registration itself is all this stub has to support.
    on: (_event: 'enter-full-screen' | 'leave-full-screen', _listener: () => void) => {}
  };

  return {
    win,
    webContents,
    setDestroyed: (value: boolean) => {
      isDestroyed = value;
    }
  };
};

let Server: typeof import('../../app/rpc').Server;

beforeAll(async () => {
  registerElectronMock();
  resetElectronMock();
  const electronMock = getElectronMock();
  electronMock.ipcMain.on = ipcMainOnMock;
  electronMock.ipcMain.removeListener = ipcMainRemoveListenerMock;
  ({Server} = await importFresh<typeof import('../../app/rpc')>('../../app/rpc', 'rpc_server_unit'));
});

beforeEach(() => {
  ipcMainOnMock.mockClear();
  ipcMainRemoveListenerMock.mockClear();
});

afterEach(() => {
  delete process.env.RUN_E2E;
});

test('registers IPC channel and emits init after renderer loads', () => {
  const {win, webContents} = createWindowStub();
  const server = new Server(win);

  expect(ipcMainOnMock).toHaveBeenCalledWith(server.id, expect.any(Function));

  webContents.emit('did-finish-load');

  expect(webContents.send).toHaveBeenCalledWith('init', server.id, 'default-profile');

  server.destroy();
});

test('routes renderer-to-main events through typed listeners', () => {
  const {win} = createWindowStub();
  const server = new Server(win);

  const commandListener = mock((_command: string) => {});
  server.on('command', commandListener);

  server.ipcListener(unusedIpcMainEvent, {ev: 'command', data: asCommandId('tab:new')});

  expect(commandListener).toHaveBeenCalledWith('tab:new');

  server.destroy();
});

test('emits events to renderer only while window is alive', () => {
  const {win, webContents, setDestroyed} = createWindowStub();
  const server = new Server(win);

  expect(server.emit('reload')).toBe(true);
  expect(webContents.send).toHaveBeenCalledWith(server.id, {ch: 'reload', data: undefined});

  setDestroyed(true);
  expect(server.emit('reload')).toBe(false);

  server.destroy();
});

test('destroy removes listeners from emitter, webContents, and ipcMain', () => {
  const {win, webContents} = createWindowStub();
  const server = new Server(win);

  const listener = mock(() => {});
  server.on('close', listener);

  server.destroy();

  expect(webContents.removeAllListeners).toHaveBeenCalledTimes(1);
  expect(ipcMainRemoveListenerMock).toHaveBeenCalledWith(server.id, expect.any(Function));
});
