/** @file Electron IPC transport adapter for renderer-side command and event APIs. */
import {ipcRenderer} from '../utils/ipc';

import rpc from '../rpc';
import type {RendererCommandTransport} from '@shared/types/transport';

/** Host-agnostic transport for command invocation and event streams. */
export const transport: RendererCommandTransport = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  emit: (event, payload) => {
    const rpcEvent = event as Parameters<typeof rpc.emit>[0];
    const rpcPayload = payload as Parameters<typeof rpc.emit>[1];

    return rpc.emit(rpcEvent, rpcPayload);
  },
  on: (event, listener) => {
    rpc.on(event, listener);
    return transport;
  },
  once: (event, listener) => {
    rpc.once(event, listener);
    return transport;
  },
  off: (event, listener) => {
    rpc.off(event, listener);
    return transport;
  },
  removeAllListeners: () => {
    rpc.removeAllListeners();
    return transport;
  },
  destroy: () => {
    rpc.destroy();
  }
};
