/** @file Covers command-registry compatibility aliases and legacy handlers. */
import {afterAll, beforeAll, beforeEach, expect, mock, test} from 'bun:test';
import {SESSION_SEARCH} from '@shared/constants/sessions';
import type {CommandDefinition} from '@shared/types/commands';

let decoratedKeymaps: Record<string, string[]> = {};
let runtimeCommands: CommandDefinition[] = [];
const invokeMock = mock(async (channel: string) => {
  if (channel === 'getRuntimePluginCommands') {
    return runtimeCommands;
  }
  if (channel === 'getDecoratedKeymaps') {
    return decoratedKeymaps;
  }
  return {};
});

mock.module('../../lib/transport/electron-ipc-transport', () => ({
  transport: {
    invoke: invokeMock
  }
}));

let registerCommandHandlers: typeof import('../../lib/command-registry').registerCommandHandlers;
let getCommandHandler: typeof import('../../lib/command-registry').getCommandHandler;
let register: typeof import('../../lib/command-registry').register;
let update: typeof import('../../lib/command-registry').update;
let remove: typeof import('../../lib/command-registry').remove;
let get: typeof import('../../lib/command-registry').get;
let list: typeof import('../../lib/command-registry').list;
let has: typeof import('../../lib/command-registry').has;
let validateArgs: typeof import('../../lib/command-registry').validateArgs;
let registerCommand: typeof import('../../lib/command-registry').registerCommand;
let createCommand: typeof import('../../lib/command-registry').createCommand;
let updateCommand: typeof import('../../lib/command-registry').updateCommand;
let replaceCommand: typeof import('../../lib/command-registry').replaceCommand;
let removeCommand: typeof import('../../lib/command-registry').removeCommand;
let deleteCommand: typeof import('../../lib/command-registry').deleteCommand;
let getCommand: typeof import('../../lib/command-registry').getCommand;
let getCommandDefinition: typeof import('../../lib/command-registry').getCommandDefinition;
let listCommands: typeof import('../../lib/command-registry').listCommands;
let enumerateCommands: typeof import('../../lib/command-registry').enumerateCommands;
let hasCommand: typeof import('../../lib/command-registry').hasCommand;
let hasCommandDefinition: typeof import('../../lib/command-registry').hasCommandDefinition;
let validateCommandArgs: typeof import('../../lib/command-registry').validateCommandArgs;
let validateCommandArgsFor: typeof import('../../lib/command-registry').validateCommandArgsFor;

const TEST_COMMAND_PREFIX = 'test:command-registry:compat';
const focusActiveTermMock = mock(() => {});
const previousWindow = (globalThis as {window?: Record<string, unknown>}).window;

beforeAll(async () => {
  (globalThis as {window?: Record<string, unknown>}).window = {focusActiveTerm: focusActiveTermMock};

  ({
    registerCommandHandlers,
    getCommandHandler,
    register,
    update,
    remove,
    get,
    list,
    has,
    validateArgs,
    registerCommand,
    createCommand,
    updateCommand,
    replaceCommand,
    removeCommand,
    deleteCommand,
    getCommand,
    getCommandDefinition,
    listCommands,
    enumerateCommands,
    hasCommand,
    hasCommandDefinition,
    validateCommandArgs,
    validateCommandArgsFor
  } = await import('../../lib/command-registry.ts?command_registry_compat_unit'));
});

afterAll(() => {
  if (previousWindow === undefined) {
    delete (globalThis as {window?: Record<string, unknown>}).window;
    return;
  }

  (globalThis as {window?: Record<string, unknown>}).window = previousWindow;
});

beforeEach(() => {
  invokeMock.mockClear();
  focusActiveTermMock.mockClear();
  decoratedKeymaps = {};
  runtimeCommands = [];

  list()
    .filter((command) => command.id.startsWith(TEST_COMMAND_PREFIX))
    .forEach((command) => {
      remove(command.id);
    });
});

test('registerCommandHandlers ignores undefined input without mutating the registry', () => {
  const searchCloseHandlerBeforeUndefinedCall = getCommandHandler('editor:search-close');

  registerCommandHandlers(undefined);

  expect(getCommandHandler('editor:search-close')).toBe(searchCloseHandlerBeforeUndefinedCall);
});

test('compatibility aliases mirror the primary command-registry APIs', () => {
  expect(registerCommand).toBe(register);
  expect(createCommand).toBe(register);
  expect(updateCommand).toBe(update);
  expect(replaceCommand).toBe(update);
  expect(removeCommand).toBe(remove);
  expect(deleteCommand).toBe(remove);
  expect(getCommand).toBe(get);
  expect(getCommandDefinition).toBe(get);
  expect(listCommands).toBe(list);
  expect(enumerateCommands).toBe(list);
  expect(hasCommand).toBe(has);
  expect(hasCommandDefinition).toBe(has);
  expect(validateCommandArgs).toBe(validateArgs);
  expect(validateCommandArgsFor).toBe(validateArgs);
});

test('legacy search-close handler dispatches closeSearch and focuses the active terminal', () => {
  const dispatch = mock(() => {});
  const innerDispatch = mock(() => {});

  getCommandHandler('editor:search-close')?.('event-payload', dispatch as unknown as never);

  expect(dispatch).toHaveBeenCalledTimes(1);
  const dispatchedThunk = dispatch.mock.calls[0]?.[0];
  expect(dispatchedThunk).toBeFunction();
  if (typeof dispatchedThunk !== 'function') {
    throw new Error('Expected the legacy search-close handler to dispatch a thunk');
  }

  dispatchedThunk(innerDispatch as never, () => ({
    sessions: {
      activeUid: 'active-session',
      sessions: {
        'active-session': {
          search: true
        }
      }
    }
  }));

  expect(innerDispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      type: SESSION_SEARCH,
      uid: 'active-session',
      value: false
    })
  );
  expect(focusActiveTermMock).toHaveBeenCalledTimes(1);
});
