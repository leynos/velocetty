/** @file Electron IPC transport adapter for renderer-side command and event APIs. */
import {ipcRenderer} from '../utils/ipc';

import rpc from '../rpc';
import type {RendererCommandTransport} from '@shared/types/transport';

/** Host-agnostic transport for command invocation and event streams. */
export const transport: RendererCommandTransport = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  emit: (event, ...payload) =>
    // The rpc client uses overloads (no-data vs data) while the transport
    // contract uses a conditional rest tuple.  Cast to the implementation
    // signature so the spread satisfies both overloads.
    (rpc.emit as (ev: typeof event, data?: (typeof payload)[0]) => boolean)(event, ...payload),
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
