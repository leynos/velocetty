/**
 * @file Adapts the renderer command transport to the settings gateway port.
 *
 * The gateway never reaches Electron-backed IPC itself: the config-change
 * subscription arrives as a dependency from `lib/transport/`, so a test can
 * drive the gateway with doubles and the wiring lives at the transport
 * boundary.
 */

import type {RendererCommandTransport} from '@shared/types/transport';
import type {JsonValue} from '@shared/types/json';
import type {SettingTarget} from '@shared/settings/protocol';
import {
  subscribeToConfigChange as subscribeToTransportConfigChange,
  type ConfigChangeSubscription
} from '../../transport/config-change-subscription';
import type {SettingsGateway} from '../ports';

/** The command transport surface the gateway needs; only invoke is used. */
export type SettingsCommandTransport = Pick<RendererCommandTransport, 'invoke'>;

/**
 * Builds a gateway over the renderer transport.
 *
 * `ipcRenderer.invoke` cannot be cancelled, so the abort signal only discards a
 * superseded result; a write the main process started still completes.
 *
 * @param transport - The renderer command transport, of which only `invoke` is used.
 * @param subscribeToConfigChange - The transport adapter that reports config
 * reloads; defaulted so existing callers keep their one-argument form.
 * @returns The settings gateway.
 *
 * @example
 * const gateway = createTransportSettingsGateway(transport);
 * await gateway.getSnapshot(new AbortController().signal);
 */
export const createTransportSettingsGateway = (
  transport: SettingsCommandTransport,
  subscribeToConfigChange: ConfigChangeSubscription = subscribeToTransportConfigChange
): SettingsGateway => ({
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
