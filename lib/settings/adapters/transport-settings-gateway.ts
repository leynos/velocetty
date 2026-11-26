/**
 * @file Adapts the renderer command transport to the settings gateway port.
 */

import type {RendererCommandTransport} from '@shared/types/transport';
import type {JsonValue} from '@shared/types/json';
import type {SettingTarget} from '@shared/settings/protocol';
import {ipcRenderer} from '../../utils/ipc';
import type {SettingsGateway} from '../ports';

/**
 * Subscribes to the main process's payload-free config change event.
 *
 * The event is sent with `webContents.send`, not through the RPC envelope, so
 * it is listened for on `ipcRenderer` directly rather than on the transport.
 *
 * @param onChanged - Called after every reload.
 * @returns The unsubscribe function.
 */
export const subscribeToConfigChange = (onChanged: () => void): (() => void) => {
  const handler = () => onChanged();
  ipcRenderer.on('config change', handler);
  return () => {
    ipcRenderer.removeListener('config change', handler);
  };
};

/**
 * Builds a gateway over the renderer transport.
 *
 * `ipcRenderer.invoke` cannot be cancelled, so the abort signal only discards a
 * superseded result; a write the main process started still completes.
 *
 * @param transport - The renderer command transport, of which only `invoke` is used.
 * @returns The settings gateway.
 *
 * @example
 * const gateway = createTransportSettingsGateway(transport);
 * await gateway.getSnapshot(new AbortController().signal);
 */
/** The command transport surface the gateway needs; only invoke is used. */
export type SettingsCommandTransport = Pick<RendererCommandTransport, 'invoke'>;

export const createTransportSettingsGateway = (transport: SettingsCommandTransport): SettingsGateway => ({
  getSnapshot: async (signal) => {
    signal.throwIfAborted();
    const snapshot = await transport.invoke('settings:getSnapshot');
    signal.throwIfAborted();
    return snapshot;
  },
  setValue: (target: SettingTarget, value: JsonValue) => transport.invoke('settings:setValue', target, value),
  resetValue: (target: SettingTarget) => transport.invoke('settings:resetValue', target),
  subscribe: (onChanged) => subscribeToConfigChange(onChanged)
});
