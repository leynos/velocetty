/** @file Electron IPC transport adapter for renderer-side command and event APIs. */
import {ipcRenderer} from '../utils/ipc';
import {ipcResponseSchemas} from './ipc-schemas';

import rpc from '../rpc';
import type {IpcCommands, MainEvents} from '@shared/types/common';
import type {RendererCommandTransport} from '@shared/types/transport';

/** Host-agnostic transport for command invocation and event streams. */
export const transport: RendererCommandTransport = {
  invoke: async (channel, ...args) => {
    const result = await ipcRenderer.invoke(channel, ...args);
    // SAFETY: The command-keyed schema validates this channel's declared result; this assertion preserves its correlation across the heterogeneous schema map.
    return ipcResponseSchemas[channel].parse(result) as ReturnType<IpcCommands[typeof channel]>;
  },
  emit<Event extends keyof MainEvents>(
    event: Event,
    ...payload: [MainEvents[Event]] extends [never] ? [] : [payload: MainEvents[Event]]
  ) {
    return rpc.emit(event, ...payload);
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
  removeAllListeners: (event?) => {
    rpc.removeAllListeners(event);
    return transport;
  },
  destroy: () => {
    rpc.destroy();
  }
};
