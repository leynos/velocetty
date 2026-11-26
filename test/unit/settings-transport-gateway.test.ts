/**
 * @file Abort behaviour and dependency wiring of the transport settings gateway.
 *
 * `ipcRenderer.invoke` cannot be cancelled, so the gateway's only defence is to
 * discard a result whose signal has aborted. Without that guard, a stale
 * snapshot from a superseded render could win. The config-change subscription
 * is a dependency from `lib/transport/`, so the gateway neither imports
 * Electron-backed IPC nor hides the subscription from a test double.
 */
import {beforeAll, beforeEach, expect, mock, test} from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import type {SettingsSnapshot, SettingsWriteOutcome} from '@shared/settings/protocol';
import type {IpcCommands} from '@shared/types/common';
import type {SettingsCommandTransport} from '../../lib/settings/adapters/transport-settings-gateway';

import {importFresh} from '../testUtils/import-fresh';
import {registerModuleMock} from '../testUtils/mock-module';

const SNAPSHOT: SettingsSnapshot = {
  revision: 1,
  filePath: '/home/me/.config/Velocetty/config.json5',
  fileStatus: {kind: 'ok'},
  userValues: {},
  defaultValues: {},
  profileOverriddenKeys: []
};

/** Listeners the adapter registers on the `config change` channel. */
const configChangeListeners: Array<() => void> = [];

const ipcOn = mock((channel: string, listener: () => void) => {
  if (channel === 'config change') {
    configChangeListeners.push(listener);
  }
});

const ipcRemoveListener = mock((channel: string, listener: () => void) => {
  const index = configChangeListeners.indexOf(listener);
  if (channel === 'config change' && index !== -1) {
    configChangeListeners.splice(index, 1);
  }
});

// The adapter under test is the only module that reaches Electron-backed IPC.
registerModuleMock('../../lib/utils/ipc', () => ({
  ipcRenderer: {on: ipcOn, removeListener: ipcRemoveListener}
}));

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
let subscribeToConfigChange: typeof import('../../lib/transport/config-change-subscription')['subscribeToConfigChange'];

beforeAll(async () => {
  ({createTransportSettingsGateway} = await importFresh<
    typeof import('../../lib/settings/adapters/transport-settings-gateway')
  >('../../lib/settings/adapters/transport-settings-gateway', 'settings_transport_gateway_unit'));
  ({subscribeToConfigChange} = await importFresh<typeof import('../../lib/transport/config-change-subscription')>(
    '../../lib/transport/config-change-subscription',
    'settings_config_change_unit'
  ));
});

beforeEach(() => {
  configChangeListeners.length = 0;
  ipcOn.mockClear();
  ipcRemoveListener.mockClear();
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

test('subscribes through the injected config-change subscription', () => {
  const unsubscribe = mock(() => {});
  const subscribe = mock((_onChanged: () => void) => unsubscribe);
  const gateway = createTransportSettingsGateway(
    transportOf(async () => SNAPSHOT),
    subscribe
  );
  const onChanged = mock(() => {});

  const result = gateway.subscribe(onChanged);

  expect(subscribe).toHaveBeenCalledTimes(1);
  expect(subscribe.mock.calls[0]?.[0]).toBe(onChanged);
  expect(result).toBe(unsubscribe);
});

test('the transport adapter listens for config change and cleans up', () => {
  const onChanged = mock(() => {});

  const unsubscribe = subscribeToConfigChange(onChanged);

  expect(ipcOn).toHaveBeenCalledTimes(1);
  expect(ipcOn.mock.calls[0]?.[0]).toBe('config change');
  const registered = configChangeListeners.at(-1);
  expect(registered).toBeDefined();
  registered?.();
  expect(onChanged).toHaveBeenCalledTimes(1);

  unsubscribe();
  expect(ipcRemoveListener).toHaveBeenCalledWith('config change', registered);
  expect(configChangeListeners).toHaveLength(0);
});

test('the gateway module imports no Electron-backed IPC itself', async () => {
  const source = await fs.readFile(
    path.join(process.cwd(), 'lib/settings/adapters/transport-settings-gateway.ts'),
    'utf8'
  );

  expect(source).not.toContain('utils/ipc');
  expect(source).not.toContain("from 'electron'");
});
