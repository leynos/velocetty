/** @file Electron IPC transport adapter for renderer-side command and event APIs. */
import {ipcRenderer} from '../utils/ipc';
import {ipcResponseSchemas} from './ipc-schemas';

import rpc from '../rpc';
import type {IpcCommands} from '@shared/types/common';
import type {RendererCommandTransport} from '@shared/types/transport';

/** Host-agnostic transport for command invocation and event streams. */
export const transport: RendererCommandTransport = {
  invoke: async (channel, ...args) => {
    const result = await ipcRenderer.invoke(channel, ...args);
    // The interface contract on RendererCommandTransport.invoke already
    // constrains the return type per command.  The cast is safe because the
    // schema validates the shape at runtime; the generic key simply widens the
    // inferred parse output to `unknown`.
    return ipcResponseSchemas[channel].parse(result) as ReturnType<IpcCommands[typeof channel]>;
  },
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
  removeAllListeners: (event?) => {
    rpc.removeAllListeners(event);
    return transport;
  },
  destroy: () => {
    rpc.destroy();
  }
};
