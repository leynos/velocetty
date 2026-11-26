/**
 * @file Abort behaviour of the transport-backed settings gateway.
 *
 * `ipcRenderer.invoke` cannot be cancelled, so the gateway's only defence is
 * to discard a result whose signal has aborted. Without that guard, a stale
 * snapshot from a superseded render could win.
 */
import {beforeAll, expect, test} from 'bun:test';

import type {SettingsSnapshot, SettingsWriteOutcome} from '@shared/settings/protocol';
import type {IpcCommands} from '@shared/types/common';
import type {SettingsCommandTransport} from '../../lib/settings/adapters/transport-settings-gateway';

import {registerElectronMock, resetElectronMock} from '../testUtils/electron-path';
import {importFresh} from '../testUtils/import-fresh';

const SNAPSHOT: SettingsSnapshot = {
  revision: 1,
  filePath: '/home/me/.config/Velocetty/config.json5',
  fileStatus: {kind: 'ok'},
  userValues: {},
  defaultValues: {},
  profileOverriddenKeys: []
};

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
};

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {promise, resolve};
};

/** What a settings command can answer: a snapshot or a write outcome. */
type SettingsResponse = SettingsSnapshot | SettingsWriteOutcome;

/**
 * Builds the invoke-only transport the gateway accepts.
 *
 * `answer` receives the channel and arguments and supplies the response that
 * channel expects; the cast is the test's claim that it did so.
 */
const transportOf = (
  answer: (channel: string, args: readonly unknown[]) => Promise<SettingsResponse>
): SettingsCommandTransport => {
  const invoke: SettingsCommandTransport['invoke'] = async (channel, ...args) => {
    const response = await answer(String(channel), args);
    // SAFETY: the gateway issues only settings commands, and `answer` returns
    // the response matching the channel it was given.
    return response as ReturnType<IpcCommands[typeof channel]>;
  };
  return {invoke};
};

let createTransportSettingsGateway: typeof import('../../lib/settings/adapters/transport-settings-gateway')['createTransportSettingsGateway'];

beforeAll(async () => {
  // The gateway module imports `lib/utils/ipc`, which reads `electron` at
  // evaluation time; install the mock before the fresh import.
  resetElectronMock();
  registerElectronMock();
  ({createTransportSettingsGateway} = await importFresh<
    typeof import('../../lib/settings/adapters/transport-settings-gateway')
  >('../../lib/settings/adapters/transport-settings-gateway', 'settings_transport_gateway_unit'));
});

test('an already-aborted signal rejects without invoking the transport', async () => {
  let invocations = 0;
  const transport = transportOf(async () => {
    invocations += 1;
    return SNAPSHOT;
  });
  const gateway = createTransportSettingsGateway(transport);
  const controller = new AbortController();
  controller.abort();

  await expect(gateway.getSnapshot(controller.signal)).rejects.toMatchObject({name: 'AbortError'});
  expect(invocations).toBe(0);
});

test('a result that arrives after the signal aborts is discarded', async () => {
  const load = deferred<SettingsSnapshot>();
  const transport = transportOf(() => load.promise);
  const gateway = createTransportSettingsGateway(transport);
  const controller = new AbortController();

  const pending = gateway.getSnapshot(controller.signal);
  controller.abort();
  load.resolve(SNAPSHOT);

  await expect(pending).rejects.toMatchObject({name: 'AbortError'});
});

test('writes forward the channel, target, and value unaltered', async () => {
  const invocations: unknown[][] = [];
  const transport = transportOf(async (channel, args) => {
    invocations.push([channel, ...args]);
    return {kind: 'applied', snapshot: SNAPSHOT};
  });
  const gateway = createTransportSettingsGateway(transport);

  await gateway.setValue({scope: 'core', key: 'fontSize'}, 16);
  await gateway.resetValue({scope: 'core', key: 'fontSize'});

  expect(invocations).toEqual([
    ['settings:setValue', {scope: 'core', key: 'fontSize'}, 16],
    ['settings:resetValue', {scope: 'core', key: 'fontSize'}]
  ]);
});
