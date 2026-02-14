/** @file Verifies main-process RPC server lifecycle and IPC routing. */
import {EventEmitter} from 'node:events';

import {afterEach, beforeAll, beforeEach, expect, mock, test} from 'bun:test';

import {getElectronMock, registerElectronMock, resetElectronMock} from '../testUtils/electron-path';

type IpcMainListener = (event: unknown, payload: {ev: string; data?: unknown}) => void;

const ipcMainOnMock = mock((_channel: string, _listener: IpcMainListener) => {});
const ipcMainRemoveListenerMock = mock((_channel: string, _listener: IpcMainListener) => {});

mock.module('uuid', () => ({
  v4: () => 'test-rpc-id'
}));

class FakeWebContents extends EventEmitter {
  send = mock((_channel: string, _payload: unknown, _profileName?: string) => {});
  removeAllListeners = mock(() => super.removeAllListeners());
}

const createWindowStub = () => {
  const webContents = new FakeWebContents();
  let isDestroyed = false;

  const win = {
    profileName: 'default-profile',
    webContents,
    isDestroyed: () => isDestroyed
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
  ({Server} = await import('../../app/rpc.ts?rpc_server_unit'));
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
  const server = new Server(win as any);

  expect(ipcMainOnMock).toHaveBeenCalledWith(server.id, expect.any(Function));

  webContents.emit('did-finish-load');

  expect(webContents.send).toHaveBeenCalledWith('init', server.id, 'default-profile');

  server.destroy();
});

test('routes renderer-to-main events through typed listeners', () => {
  const {win} = createWindowStub();
  const server = new Server(win as any);

  const commandListener = mock((_command: string) => {});
  server.on('command', commandListener);

  server.ipcListener({} as any, {ev: 'command', data: 'tab:new'});

  expect(commandListener).toHaveBeenCalledWith('tab:new');

  server.destroy();
});

test('emits events to renderer only while window is alive', () => {
  const {win, webContents, setDestroyed} = createWindowStub();
  const server = new Server(win as any);

  expect(server.emit('reload')).toBe(true);
  expect(webContents.send).toHaveBeenCalledWith(server.id, {ch: 'reload', data: undefined});

  setDestroyed(true);
  expect(server.emit('reload')).toBe(false);

  server.destroy();
});

test('destroy removes listeners from emitter, webContents, and ipcMain', () => {
  const {win, webContents} = createWindowStub();
  const server = new Server(win as any);

  const listener = mock(() => {});
  server.on('close', listener);

  server.destroy();

  expect(webContents.removeAllListeners).toHaveBeenCalledTimes(1);
  expect(ipcMainRemoveListenerMock).toHaveBeenCalledWith(server.id, expect.any(Function));
});
