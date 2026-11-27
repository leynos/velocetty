/**
 * @file Validation at the settings IPC boundary.
 *
 * The renderer is untrusted, so the handlers must refuse a non-editable key
 * and a non-JSON value before the service sees them. A regression here would
 * leave every service-level test green: the service assumes its caller has
 * already narrowed the target.
 */
import {beforeAll, beforeEach, expect, test} from 'bun:test';

import type {IpcHandleListener} from '../testUtils/electron-path';
import {getElectronMock, registerElectronMock, resetElectronMock} from '../testUtils/electron-path';
import {importFresh} from '../testUtils/import-fresh';

import type {SettingsService} from '../../app/settings/settings-service';
import type {SettingsSnapshot, SettingTarget, SettingsWriteOutcome} from '@shared/settings/protocol';

const SNAPSHOT: SettingsSnapshot = {
  revision: 1,
  filePath: '/home/me/.config/Velocetty/config.json5',
  fileStatus: {kind: 'ok'},
  userValues: {},
  defaultValues: {},
  profileOverriddenKeys: []
};

const APPLIED: SettingsWriteOutcome = {kind: 'applied', snapshot: SNAPSHOT};

const editableTarget: SettingTarget = {scope: 'core', key: 'fontSize'};

/**
 * The event argument the handlers ignore.
 *
 * A bare object keeps the stub honest: if a handler starts reading the event,
 * the member it reads is missing rather than plausibly faked.
 */
const unusedIpcEvent = (() => {
  // SAFETY: every settings handler ignores its event argument, so no member of
  // `IpcMainEvent` is read. A handler that starts reading one still compiles
  // against this empty object and fails at its own use site instead.
  return {} as Electron.IpcMainEvent;
})();

let handlers: Map<string, IpcHandleListener>;
let calls: string[];
let registerSettingsIpcHandlers: (service: SettingsService) => void;

const serviceDouble = (): SettingsService => ({
  getSnapshot: () => {
    calls.push('getSnapshot');
    return SNAPSHOT;
  },
  resetValue: async (target: SettingTarget) => {
    calls.push(`resetValue ${target.key}`);
    return APPLIED;
  },
  setValue: async (target: SettingTarget, value: unknown) => {
    calls.push(`setValue ${target.key} ${JSON.stringify(value)}`);
    return APPLIED;
  }
});

const handlerFor = (channel: string): IpcHandleListener => {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`Expected a handler for ${channel}.`);
  }
  return handler;
};

beforeAll(async () => {
  handlers = new Map();
  resetElectronMock();
  registerElectronMock();
  getElectronMock().ipcMain.handle = (channel, handler) => {
    handlers.set(channel, handler);
  };

  ({registerSettingsIpcHandlers} = await importFresh<typeof import('../../app/settings/settings-ipc')>(
    '../../app/settings/settings-ipc',
    'settings_ipc_handlers_unit'
  ));
});

beforeEach(() => {
  handlers.clear();
  calls = [];
});

test('a service refusal crosses the IPC boundary with its reason intact', async () => {
  const refusal: SettingsWriteOutcome = {kind: 'failed', reason: 'user-config-unreadable'};
  registerSettingsIpcHandlers({
    getSnapshot: () => SNAPSHOT,
    resetValue: async () => refusal,
    setValue: async () => refusal
  });

  const setOutcome = await handlerFor('settings:setValue')(unusedIpcEvent, editableTarget, 16);
  const resetOutcome = await handlerFor('settings:resetValue')(unusedIpcEvent, editableTarget);

  expect(setOutcome).toMatchObject({kind: 'failed', reason: 'user-config-unreadable'});
  expect(resetOutcome).toMatchObject({kind: 'failed', reason: 'user-config-unreadable'});
});

test('registers a handler for each settings command', () => {
  registerSettingsIpcHandlers(serviceDouble());

  expect([...handlers.keys()].toSorted()).toEqual(['settings:getSnapshot', 'settings:resetValue', 'settings:setValue']);
});

type RefusalCase = {
  readonly name: string;
  readonly channel: 'settings:setValue' | 'settings:resetValue';
  readonly args: readonly unknown[];
};

const REFUSAL_CASES: readonly RefusalCase[] = [
  {
    name: 'a non-editable css key is refused before the service',
    channel: 'settings:setValue',
    args: [{scope: 'core', key: 'css'}, 16]
  },
  {
    name: 'a non-editable plugins key is refused before the service',
    channel: 'settings:setValue',
    args: [{scope: 'core', key: 'plugins'}, 16]
  },
  {
    name: 'a non-JSON value is refused before the service',
    channel: 'settings:setValue',
    args: [editableTarget, () => 1]
  },
  {
    name: 'reset refuses an invalid target before the service',
    channel: 'settings:resetValue',
    args: [{scope: 'profile', key: 'fontSize'}]
  }
];

for (const refusal of REFUSAL_CASES) {
  // Serial: these cases share the module-level `calls` log, so running them
  // concurrently would let one case observe another case's service call.
  test.serial(refusal.name, async () => {
    registerSettingsIpcHandlers(serviceDouble());

    const outcome = await handlerFor(refusal.channel)(unusedIpcEvent, ...refusal.args);

    expect(outcome).toMatchObject({kind: 'failed', reason: 'not-editable'});
    expect(calls).toEqual([]);
  });
}

test.serial('an editable target reaches the service, and the snapshot is read through', async () => {
  registerSettingsIpcHandlers(serviceDouble());

  const outcome = await handlerFor('settings:setValue')(unusedIpcEvent, editableTarget, 16);

  expect(outcome).toEqual(APPLIED);
  expect(calls).toEqual(['setValue fontSize 16']);
  expect(handlerFor('settings:getSnapshot')(unusedIpcEvent)).toEqual(SNAPSHOT);
});
