/** @file Verifies command-registry keymap and handler behaviour. */
import {beforeAll, beforeEach, expect, mock, test} from 'bun:test';

let decoratedKeymaps: Record<string, string[]> = {};
const invokeMock = mock(async (_channel: string) => decoratedKeymaps);

mock.module('../../lib/transport/electron-ipc-transport', () => ({
  transport: {
    invoke: invokeMock
  }
}));

let getRegisteredKeys: typeof import('../../lib/command-registry').getRegisteredKeys;
let registerCommandHandlers: typeof import('../../lib/command-registry').registerCommandHandlers;
let getCommandHandler: typeof import('../../lib/command-registry').getCommandHandler;
let shouldPreventDefault: typeof import('../../lib/command-registry').shouldPreventDefault;
let register: typeof import('../../lib/command-registry').register;
let update: typeof import('../../lib/command-registry').update;
let remove: typeof import('../../lib/command-registry').remove;
let get: typeof import('../../lib/command-registry').get;
let list: typeof import('../../lib/command-registry').list;
let has: typeof import('../../lib/command-registry').has;
let validateArgs: typeof import('../../lib/command-registry').validateArgs;

const TEST_COMMAND_PREFIX = 'test:command-registry';

const createCommandDefinition = (
  commandId: string,
  title = commandId
): import('../../lib/command-registry').CommandDefinition => ({
  id: commandId,
  kind: 'frontend',
  metadata: {
    title
  }
});

beforeAll(async () => {
  (globalThis as {window?: Record<string, unknown>}).window = {};

  ({
    getRegisteredKeys,
    registerCommandHandlers,
    getCommandHandler,
    shouldPreventDefault,
    register,
    update,
    remove,
    get,
    list,
    has,
    validateArgs
  } = await import(
    '../../lib/command-registry.ts?command_registry_unit'
  ));
});

beforeEach(() => {
  invokeMock.mockClear();
  decoratedKeymaps = {};

  list()
    .filter((command) => command.id.startsWith(TEST_COMMAND_PREFIX))
    .forEach((command) => {
      remove(command.id);
    });
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

test('registry CRUD supports deterministic command enumeration', () => {
  const commandA = `${TEST_COMMAND_PREFIX}:a`;
  const commandB = `${TEST_COMMAND_PREFIX}:b`;
  const commandC = `${TEST_COMMAND_PREFIX}:c`;

  register(createCommandDefinition(commandB, 'Command B'));
  register(createCommandDefinition(commandA, 'Command A'));
  register(createCommandDefinition(commandC, 'Command C'));
  update(createCommandDefinition(commandC, 'Command C Updated'));
  remove(commandB);
  register(createCommandDefinition(commandB, 'Command B Re-added'));

  const sequenceA = list()
    .filter((command) => command.id.startsWith(TEST_COMMAND_PREFIX))
    .map((command) => command.id);

  remove(commandA);
  remove(commandB);
  remove(commandC);

  register(createCommandDefinition(commandC, 'Command C'));
  register(createCommandDefinition(commandB, 'Command B'));
  register(createCommandDefinition(commandA, 'Command A'));
  remove(commandB);
  update(createCommandDefinition(commandC, 'Command C Updated'));
  register(createCommandDefinition(commandB, 'Command B Re-added'));

  const sequenceB = list()
    .filter((command) => command.id.startsWith(TEST_COMMAND_PREFIX))
    .map((command) => command.id);

  expect(sequenceA).toEqual(sequenceB);
  expect(sequenceA).toEqual([commandA, commandB, commandC]);
});

test('registry CRUD supports create/get/update/has/remove semantics', () => {
  const commandId = `${TEST_COMMAND_PREFIX}:crud:${Date.now()}`;
  const definition = createCommandDefinition(commandId, 'Initial Title');

  expect(has(commandId)).toBe(false);
  expect(get(commandId)).toBeUndefined();

  register(definition);
  expect(has(commandId)).toBe(true);
  expect(get(commandId)).toEqual(definition);

  const updatedDefinition = {
    ...definition,
    defaultWhen: 'sessionCount > 0',
    metadata: {
      title: 'Updated Title'
    }
  };
  update(updatedDefinition);
  expect(get(commandId)).toEqual(updatedDefinition);

  expect(remove(commandId)).toBe(true);
  expect(remove(commandId)).toBe(false);
  expect(has(commandId)).toBe(false);
  expect(get(commandId)).toBeUndefined();
});

test('validateArgs returns structured errors for invalid command arguments', () => {
  const commandId = `${TEST_COMMAND_PREFIX}:validate:${Date.now()}`;
  register({
    ...createCommandDefinition(commandId, 'Validate Args'),
    argsSchema: {
      type: 'object',
      properties: {
        name: {type: 'string'},
        count: {type: 'integer', minimum: 1}
      },
      required: ['name', 'count'],
      additionalProperties: false
    }
  });

  const invalidResult = validateArgs(commandId, {name: 'alpha', count: 0});
  expect(invalidResult.ok).toBe(false);
  if (invalidResult.ok) {
    throw new Error('Expected invalid args to fail validation');
  }

  expect(invalidResult.error.code).toBe('INVALID_COMMAND_ARGS');
  expect(invalidResult.error.message).toContain(commandId);
  expect(invalidResult.error.details.commandId).toBe(commandId);
  expect(Array.isArray(invalidResult.error.details.errors)).toBe(true);
  expect(invalidResult.error.details.errors?.length).toBeGreaterThan(0);
  expect(invalidResult.error.details.errors?.[0]).toMatchObject({
    instancePath: expect.any(String),
    schemaPath: expect.any(String),
    keyword: expect.any(String),
    message: expect.any(String),
    params: expect.any(Object)
  });

  expect(validateArgs(commandId, {name: 'alpha', count: 2})).toEqual({ok: true});
});

test('validateArgs returns structured errors for unknown commands', () => {
  const commandId = `${TEST_COMMAND_PREFIX}:unknown:${Date.now()}`;

  const result = validateArgs(commandId, {name: 'alpha'});
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('Expected unknown command validation to fail');
  }

  expect(result.error.code).toBe('COMMAND_NOT_FOUND');
  expect(result.error.details).toEqual({
    commandId
  });
});

test('shouldPreventDefault keeps Electron role commands unblocked', () => {
  expect(shouldPreventDefault('editor:copy')).toBe(false);
  expect(shouldPreventDefault('window:toggleFullScreen')).toBe(false);
  expect(shouldPreventDefault('tab:new')).toBe(true);
});
