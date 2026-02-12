/** @file Verifies command-registry keymap and handler behaviour. */
import {beforeAll, beforeEach, expect, mock, test} from 'bun:test';
import {resolve} from 'node:path';

let decoratedKeymaps: Record<string, string[]> = {};
const invokeMock = mock(async (_channel: string) => decoratedKeymaps);
const ipcOnMock = mock((_channel: string, _listener: unknown) => {});
const ipcSendMock = mock((_channel: string, _payload: unknown) => {});
const ipcRemoveAllListenersMock = mock((_channel: string) => {});

const ipcModulePath = resolve('lib/utils/ipc.ts');

mock.module('../../lib/utils/ipc', () => ({
  ipcRenderer: {
    invoke: invokeMock,
    on: ipcOnMock,
    send: ipcSendMock,
    removeAllListeners: ipcRemoveAllListenersMock
  }
}));

mock.module(ipcModulePath, () => ({
  ipcRenderer: {
    invoke: invokeMock,
    on: ipcOnMock,
    send: ipcSendMock,
    removeAllListeners: ipcRemoveAllListenersMock
  }
}));

let getRegisteredKeys: typeof import('../../lib/command-registry').getRegisteredKeys;
let registerCommandHandlers: typeof import('../../lib/command-registry').registerCommandHandlers;
let getCommandHandler: typeof import('../../lib/command-registry').getCommandHandler;
let shouldPreventDefault: typeof import('../../lib/command-registry').shouldPreventDefault;

beforeAll(async () => {
  (globalThis as {window?: Record<string, unknown>}).window = {};

  ({getRegisteredKeys, registerCommandHandlers, getCommandHandler, shouldPreventDefault} = await import(
    '../../lib/command-registry.ts?command_registry_unit'
  ));
});

beforeEach(() => {
  invokeMock.mockClear();
  ipcOnMock.mockClear();
  ipcSendMock.mockClear();
  ipcRemoveAllListenersMock.mockClear();
  decoratedKeymaps = {};
});

test('getRegisteredKeys flattens decorated keymaps into shortcut-command pairs', async () => {
  decoratedKeymaps = {
    'window:new': ['ctrl+shift+n', 'ctrl+alt+n'],
    'tab:new': ['ctrl+t']
  };

  const registeredKeys = await getRegisteredKeys();

  expect(invokeMock).toHaveBeenCalledWith('getDecoratedKeymaps');
  expect(registeredKeys).toEqual({
    'ctrl+shift+n': 'window:new',
    'ctrl+alt+n': 'window:new',
    'ctrl+t': 'tab:new'
  });
});

test('registerCommandHandlers merges new handlers into registry', () => {
  const commandName = `test:command:${Date.now()}`;
  const handler = () => {};

  registerCommandHandlers({
    [commandName]: handler
  } as Record<string, (event: unknown, dispatch: unknown) => void>);

  expect(getCommandHandler(commandName)).toBe(handler);
  expect(getCommandHandler('editor:search-close')).toBeFunction();
});

test('shouldPreventDefault keeps Electron role commands unblocked', () => {
  expect(shouldPreventDefault('editor:copy')).toBe(false);
  expect(shouldPreventDefault('window:toggleFullScreen')).toBe(false);
  expect(shouldPreventDefault('tab:new')).toBe(true);
});
