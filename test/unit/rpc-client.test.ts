/** @file Verifies renderer RPC client lifecycle and event forwarding. */
import {expect, mock, test} from 'bun:test';

import type {IpcRendererEvent} from 'electron';

import Client, {type RpcClientIpc} from '../../lib/utils/rpc';

type IpcListener = (event: IpcRendererEvent, ...args: unknown[]) => void;

type RpcClientHarness = {
  createClient: () => Client;
  emitChannel: (channel: string, ...args: unknown[]) => void;
  flushDeferredReadyRegistrations: () => void;
  ipc: RpcClientIpc;
  onMock: ReturnType<typeof mock>;
  removeListenerMock: ReturnType<typeof mock>;
  sendMock: ReturnType<typeof mock>;
  windowHost: {
    __rpcId?: string;
  };
};

const createRpcClientHarness = (): RpcClientHarness => {
  const channelListeners = new Map<string, IpcListener[]>();
  const deferredReadyRegistrations: Array<() => void> = [];
  const windowHost: {__rpcId?: string} = {};

  const onMock = mock((channel: string, listener: IpcListener) => {
    const listeners = channelListeners.get(channel) ?? [];
    channelListeners.set(channel, [...listeners, listener]);
    return ipc;
  });
  const sendMock = mock((_channel: string, _payload: unknown) => {});
  const removeListenerMock = mock((channel: string, listener: IpcListener) => {
    const listeners = channelListeners.get(channel) ?? [];
    const remainingListeners = listeners.filter((registeredListener) => registeredListener !== listener);
    if (remainingListeners.length === 0) {
      channelListeners.delete(channel);
      return ipc;
    }

    channelListeners.set(channel, remainingListeners);
    return ipc;
  });

  const ipc: RpcClientIpc = {
    on: onMock,
    removeListener: removeListenerMock,
    send: sendMock
  };

  const emitChannel = (channel: string, ...args: unknown[]) => {
    const listeners = channelListeners.get(channel) ?? [];
    for (const listener of [...listeners]) {
      listener({} as IpcRendererEvent, ...args);
    }
  };

  const flushDeferredReadyRegistrations = () => {
    const callbacks = [...deferredReadyRegistrations];
    deferredReadyRegistrations.length = 0;
    for (const callback of callbacks) {
      callback();
    }
  };

  return {
    createClient: () =>
      new Client({
        deferReadyRegistration: (callback) => {
          deferredReadyRegistrations.push(callback);
        },
        ipc,
        windowHost
      }),
    emitChannel,
    flushDeferredReadyRegistrations,
    ipc,
    onMock,
    removeListenerMock,
    sendMock,
    windowHost
  };
};

test('subscribes to init channel and becomes ready when init event arrives', () => {
  const harness = createRpcClientHarness();
  const client = harness.createClient();
  const readyListener = mock(() => {});
  client.on('ready', readyListener);

  expect(harness.onMock).toHaveBeenCalledWith('init', expect.any(Function));

  harness.emitChannel('init', 'rpc-uid', 'default-profile');

  expect(harness.windowHost.__rpcId).toBe('rpc-uid');
  expect(harness.onMock).toHaveBeenCalledWith('rpc-uid', expect.any(Function));
  expect(readyListener).toHaveBeenCalledTimes(1);

  client.emit('command', 'tab:new');
  expect(harness.sendMock).toHaveBeenCalledWith('rpc-uid', {
    data: 'tab:new',
    ev: 'command'
  });
});

test('reuses cached rpc id and emits ready on next tick', () => {
  const harness = createRpcClientHarness();
  harness.windowHost.__rpcId = 'cached-rpc-id';

  const client = harness.createClient();
  const readyListener = mock(() => {});
  client.on('ready', readyListener);

  harness.flushDeferredReadyRegistrations();

  expect(harness.onMock).toHaveBeenCalledWith('cached-rpc-id', expect.any(Function));
  expect(readyListener).toHaveBeenCalledTimes(1);
});

test('throws when emitting commands before the rpc channel is ready', () => {
  const harness = createRpcClientHarness();
  const client = harness.createClient();

  expect(() => client.emit('command', 'tab:new')).toThrow('Not ready');
});

test('forwards renderer events and cleans up listeners on destroy', () => {
  const harness = createRpcClientHarness();
  harness.windowHost.__rpcId = 'forwarded-rpc-id';

  const client = harness.createClient();
  harness.flushDeferredReadyRegistrations();

  const reloadListener = mock(() => {});
  const sessionDataListener = mock((_value: string) => {});
  client.on('reload', reloadListener);
  client.on('session data', sessionDataListener);

  harness.emitChannel('forwarded-rpc-id', {ch: 'reload'});
  harness.emitChannel('forwarded-rpc-id', {ch: 'session data', data: 'session-output'});

  expect(reloadListener).toHaveBeenCalledTimes(1);
  expect(sessionDataListener).toHaveBeenCalledWith('session-output');

  client.destroy();
  expect(harness.removeListenerMock).toHaveBeenCalledWith('forwarded-rpc-id', expect.any(Function));
});

test('removeAllListeners forwards event argument to emitter', () => {
  const harness = createRpcClientHarness();
  harness.windowHost.__rpcId = 'per-event-rpc-id';

  const client = harness.createClient();
  harness.flushDeferredReadyRegistrations();

  const listener = mock(() => {});
  client.on('session data', listener);

  client.removeAllListeners('session data');

  harness.emitChannel('per-event-rpc-id', {ch: 'session data', data: 'late'});
  expect(listener).not.toHaveBeenCalled();
});
