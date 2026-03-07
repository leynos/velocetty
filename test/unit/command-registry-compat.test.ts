/**
 * @file Verifies the compatibility-alias and legacy-handler behaviour exposed
 * by the shared command-registry module.
 *
 * Responsibilities:
 * - assert that legacy alias exports remain wired to the primary
 *   command-registry APIs
 * - verify `registerCommandHandlers(...)` ignores undefined input without
 *   mutating the existing registry
 * - confirm the legacy `editor:search-close` handler still dispatches the
 *   expected close-search action and restores terminal focus
 *
 * Invariants:
 * - compatibility aliases continue to reference the same callable
 *   implementations as the primary exports
 * - the built-in legacy handler remains registered throughout the suite
 * - each test runs against an isolated command-registry module instance and a
 *   reset transport mock state
 *
 * Usage:
 * - run this module directly with
 *   `bun test --max-concurrency=1 test/unit/command-registry-compat.test.ts`
 * - the suite installs its own IPC transport mock and temporary
 *   `window.focusActiveTerm` shim during `beforeAll`, then restores the prior
 *   property state in `afterAll`
 *
 * Related modules:
 * - `../../lib/command-registry.ts` implements the compatibility aliases and
 *   legacy handlers under test
 * - `./command-registry.test.ts` covers the core keymap and CRUD behaviour for
 *   the same module
 * - `./ensure-directory-path.test.ts` is the companion example for this
 *   richer test-module header format
 */
import {afterAll, afterEach, beforeAll, beforeEach, expect, mock, test} from 'bun:test';
import {SESSION_SEARCH} from '@shared/constants/sessions';
import type {CommandDefinition} from '@shared/types/commands';

import {installTestWindow} from '../testUtils/global-window';

let decoratedKeymaps: Record<string, string[]> = {};
let runtimeCommands: CommandDefinition[] = [];
const invokeMock = mock(async (channel: string) => {
  if (channel === 'getRuntimePluginCommands') {
    return runtimeCommands;
  }
  if (channel === 'getDecoratedKeymaps') {
    return decoratedKeymaps;
  }
  throw new Error(`Unexpected IPC channel: ${channel}`);
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
const windowHost = globalThis as {window?: Record<string, unknown>};
const previousFocusActiveTerm = windowHost.window?.focusActiveTerm;
let restoreWindow = () => {};
let moduleInstanceCounter = 0;

beforeAll(() => {
  restoreWindow = installTestWindow(windowHost.window ?? {});
  windowHost.window.focusActiveTerm = focusActiveTermMock;
});

afterAll(() => {
  if (windowHost.window !== undefined) {
    if (previousFocusActiveTerm === undefined) {
      delete windowHost.window.focusActiveTerm;
    } else {
      windowHost.window.focusActiveTerm = previousFocusActiveTerm;
    }
  }
  restoreWindow();
});

afterEach(() => {
  mock.restore();
});

beforeEach(async () => {
  invokeMock.mockClear();
  focusActiveTermMock.mockClear();
  decoratedKeymaps = {};
  runtimeCommands = [];

  moduleInstanceCounter += 1;
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
  } = await import(`../../lib/command-registry.ts?command_registry_compat_unit=${moduleInstanceCounter}`));

  list()
    .filter((command) => command.id.startsWith(TEST_COMMAND_PREFIX))
    .forEach((command) => {
      remove(command.id);
    });
});

test('registerCommandHandlers ignores undefined input without mutating the registry', () => {
  const registryBeforeUndefinedCall = list().map((command) => ({
    id: command.id,
    handler: getCommandHandler(command.id)
  }));

  registerCommandHandlers(undefined);

  const registryAfterUndefinedCall = list().map((command) => ({
    id: command.id,
    handler: getCommandHandler(command.id)
  }));

  expect(registryAfterUndefinedCall).toStrictEqual(registryBeforeUndefinedCall);
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
