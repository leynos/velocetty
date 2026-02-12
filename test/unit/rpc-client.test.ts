/** @file Verifies renderer RPC client lifecycle and event forwarding. */
import {afterEach, beforeAll, beforeEach, expect, mock, test} from 'bun:test';

import type {IpcRendererEvent} from 'electron';

type IpcListener = (event: IpcRendererEvent, ...args: any[]) => void;

const channelListeners = new Map<string, IpcListener[]>();
const onMock = mock((channel: string, listener: IpcListener) => {
  const listeners = channelListeners.get(channel) ?? [];
  listeners.push(listener);
  channelListeners.set(channel, listeners);
});
const sendMock = mock((_channel: string, _payload: unknown) => {});
const removeAllListenersMock = mock((channel: string) => {
  channelListeners.delete(channel);
});

const emitChannel = (channel: string, ...args: any[]) => {
  const listeners = channelListeners.get(channel) ?? [];
  for (const listener of listeners) {
    listener({} as IpcRendererEvent, ...args);
  }
};

mock.module('../../lib/utils/ipc', () => ({
  ipcRenderer: {
    on: onMock,
    send: sendMock,
    removeAllListeners: removeAllListenersMock
  }
}));

let Client: typeof import('../../lib/utils/rpc').default;

beforeAll(async () => {
  ({default: Client} = await import('../../lib/utils/rpc'));
});

beforeEach(() => {
  channelListeners.clear();
  onMock.mockClear();
  sendMock.mockClear();
  removeAllListenersMock.mockClear();
  (globalThis as {window?: Record<string, unknown>}).window = {};
});

afterEach(() => {
  delete (globalThis as {window?: Record<string, unknown>}).window;
});

test('subscribes to init channel and becomes ready when init event arrives', () => {
  const client = new Client();
  const readyListener = mock(() => {});
  client.on('ready', readyListener);

  expect(onMock).toHaveBeenCalledWith('init', expect.any(Function));

  emitChannel('init', 'rpc-uid', 'default-profile');

  expect((globalThis as any).window.__rpcId).toBe('rpc-uid');
  expect(onMock).toHaveBeenCalledWith('rpc-uid', expect.any(Function));
  expect(readyListener).toHaveBeenCalledTimes(1);

  client.emit('command', 'tab:new');
  expect(sendMock).toHaveBeenCalledWith('rpc-uid', {ev: 'command', data: 'tab:new'});
});

test('reuses cached rpc id and emits ready on next tick', async () => {
  (globalThis as any).window.__rpcId = 'cached-rpc-id';

  const client = new Client();
  const readyListener = mock(() => {});
  client.on('ready', readyListener);

  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(onMock).toHaveBeenCalledWith('cached-rpc-id', expect.any(Function));
  expect(readyListener).toHaveBeenCalledTimes(1);
});

test('throws when emitting commands before the rpc channel is ready', () => {
  const client = new Client();

  expect(() => client.emit('command', 'tab:new')).toThrow('Not ready');
});

test('forwards renderer events and cleans up listeners on destroy', async () => {
  (globalThis as any).window.__rpcId = 'forwarded-rpc-id';
  const client = new Client();

  await new Promise((resolve) => setTimeout(resolve, 0));

  const reloadListener = mock(() => {});
  const sessionDataListener = mock((_value: string) => {});
  client.on('reload', reloadListener);
  client.on('session data', sessionDataListener);

  emitChannel('forwarded-rpc-id', {ch: 'reload'});
  emitChannel('forwarded-rpc-id', {ch: 'session data', data: 'session-output'});

  expect(reloadListener).toHaveBeenCalledTimes(1);
  expect(sessionDataListener).toHaveBeenCalledWith('session-output');

  client.destroy();
  expect(removeAllListenersMock).toHaveBeenCalledWith('forwarded-rpc-id');
});
