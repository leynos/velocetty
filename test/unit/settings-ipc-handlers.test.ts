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

test('registers a handler for each settings command', () => {
  registerSettingsIpcHandlers(serviceDouble());

  expect([...handlers.keys()].toSorted()).toEqual(['settings:getSnapshot', 'settings:resetValue', 'settings:setValue']);
});

test('a non-editable key is refused before the service', async () => {
  registerSettingsIpcHandlers(serviceDouble());
  for (const key of ['css', 'plugins']) {
    const outcome = await handlerFor('settings:setValue')(unusedIpcEvent, {scope: 'core', key}, 16);
    expect(outcome).toEqual({
      kind: 'failed',
      reason: 'not-editable',
      detail: 'The setting target is not editable.'
    });
  }
  expect(calls).toEqual([]);
});

test('a non-JSON value is refused before the service', async () => {
  registerSettingsIpcHandlers(serviceDouble());

  const outcome = await handlerFor('settings:setValue')(unusedIpcEvent, editableTarget, () => 1);

  expect(outcome).toEqual({
    kind: 'failed',
    reason: 'not-editable',
    detail: 'The value is not JSON.'
  });
  expect(calls).toEqual([]);
});

test('reset refuses an invalid target before the service', async () => {
  registerSettingsIpcHandlers(serviceDouble());

  const outcome = await handlerFor('settings:resetValue')(unusedIpcEvent, {scope: 'profile', key: 'fontSize'});

  expect(outcome).toEqual({
    kind: 'failed',
    reason: 'not-editable',
    detail: 'The setting target is not editable.'
  });
  expect(calls).toEqual([]);
});

test('an editable target reaches the service, and the snapshot is read through', async () => {
  registerSettingsIpcHandlers(serviceDouble());

  const outcome = await handlerFor('settings:setValue')(unusedIpcEvent, editableTarget, 16);

  expect(outcome).toEqual(APPLIED);
  expect(calls).toEqual(['setValue fontSize 16']);
  expect(handlerFor('settings:getSnapshot')(unusedIpcEvent)).toEqual(SNAPSHOT);
});
