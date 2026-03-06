/** @file Verifies command-registry keymap and handler behaviour. */
import {beforeAll, beforeEach, expect, mock, test} from 'bun:test';
import type {CommandDefinition, CommandId} from '@shared/types/commands';
import {goldenPathCommandDefinition, GOLDEN_PATH_COMMAND_ID} from '@shared/runtime/golden-path-demo';

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
let commandRegistry: typeof import('../../lib/command-registry').commandRegistry;
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

const TEST_COMMAND_PREFIX = 'test:command-registry';
const asCommandId = (value: string): CommandId => value as CommandId;

const createCommandDefinition = (commandId: string, title = commandId): CommandDefinition => ({
  id: asCommandId(commandId),
  kind: 'frontend',
  metadata: {
    title
  }
});

const focusActiveTermMock = mock(() => {});

beforeAll(async () => {
  (globalThis as {window?: Record<string, unknown>}).window = {focusActiveTerm: focusActiveTermMock};

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
    validateArgs,
    commandRegistry,
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
  } = await import('../../lib/command-registry.ts?command_registry_unit'));
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

test('getRegisteredKeys synchronizes runtime plugin command registrations', async () => {
  const nonRuntimeCommandId = `${TEST_COMMAND_PREFIX}:non-runtime`;
  register(createCommandDefinition(nonRuntimeCommandId, 'Non-runtime command'));

  runtimeCommands = [{...goldenPathCommandDefinition}];
  decoratedKeymaps = {
    [GOLDEN_PATH_COMMAND_ID]: ['ctrl+alt+shift+g']
  };

  const registeredKeys = await getRegisteredKeys();
  expect(registeredKeys['ctrl+alt+shift+g']).toBe(GOLDEN_PATH_COMMAND_ID);
  expect(get(GOLDEN_PATH_COMMAND_ID)).toEqual(goldenPathCommandDefinition);
  expect(get(nonRuntimeCommandId)).toEqual(createCommandDefinition(nonRuntimeCommandId, 'Non-runtime command'));

  runtimeCommands = [];
  decoratedKeymaps = {};
  await getRegisteredKeys();

  expect(get(GOLDEN_PATH_COMMAND_ID)).toBeUndefined();
  expect(get(nonRuntimeCommandId)).toEqual(createCommandDefinition(nonRuntimeCommandId, 'Non-runtime command'));
});

test('registerCommandHandlers merges new handlers into registry', () => {
  const searchCloseHandlerBeforeUndefinedCall = getCommandHandler('editor:search-close');

  registerCommandHandlers(undefined);

  expect(getCommandHandler('editor:search-close')).toBe(searchCloseHandlerBeforeUndefinedCall);

  const commandName = `test:command:${Date.now()}`;
  const handler = () => {};

  registerCommandHandlers({
    [commandName]: handler
  } as Record<string, (event: unknown, dispatch: unknown) => void>);

  expect(getCommandHandler(commandName)).toBe(handler);
  expect(getCommandHandler('editor:search-close')).toBeFunction();
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

  getCommandHandler('editor:search-close')?.('event-payload', dispatch as unknown as never);

  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(focusActiveTermMock).toHaveBeenCalledTimes(1);
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
  expect(
    list()
      .filter((command) => command.id.startsWith(TEST_COMMAND_PREFIX))
      .map((command) => command.id)
  ).toContain(commandId);

  const updatedDefinition = {
    ...definition,
    defaultWhen: 'sessionCount > 0',
    metadata: {
      title: 'Updated Title'
    }
  };
  update(updatedDefinition);
  expect(get(commandId)).toEqual(updatedDefinition);
  expect(list().find((command) => command.id === commandId)).toEqual(updatedDefinition);

  expect(remove(commandId)).toBe(true);
  expect(remove(commandId)).toBe(false);
  expect(has(commandId)).toBe(false);
  expect(get(commandId)).toBeUndefined();
  expect(list().some((command) => command.id === commandId)).toBe(false);
});

test('commandRegistry facade mirrors top-level CRUD behaviour', () => {
  const commandId = `${TEST_COMMAND_PREFIX}:facade:${Date.now()}`;
  const definition = createCommandDefinition(commandId, 'Facade Command');

  expect(has(commandId)).toBe(false);
  expect(get(commandId)).toBeUndefined();

  commandRegistry.register(definition);
  expect(commandRegistry.has(commandId)).toBe(true);
  expect(commandRegistry.get(commandId)).toEqual(definition);
  expect(has(commandId)).toBe(true);
  expect(get(commandId)).toEqual(definition);

  const updatedDefinition = {
    ...definition,
    metadata: {
      title: 'Facade Command Updated'
    }
  };

  commandRegistry.update(updatedDefinition);
  expect(commandRegistry.get(commandId)).toEqual(updatedDefinition);
  expect(get(commandId)).toEqual(updatedDefinition);

  const facadeListIds = commandRegistry
    .list()
    .filter((command) => command.id.startsWith(TEST_COMMAND_PREFIX))
    .map((command) => command.id);

  const topLevelListIds = list()
    .filter((command) => command.id.startsWith(TEST_COMMAND_PREFIX))
    .map((command) => command.id);

  expect(facadeListIds).toEqual(topLevelListIds);
  expect(facadeListIds).toContain(commandId);
  expect(commandRegistry.validateArgs(commandId, {})).toMatchObject({ok: true});

  commandRegistry.remove(commandId);
  expect(commandRegistry.has(commandId)).toBe(false);
  expect(commandRegistry.get(commandId)).toBeUndefined();
  expect(has(commandId)).toBe(false);
  expect(get(commandId)).toBeUndefined();
});

test('get/list defensively clone schema and metadata definitions', () => {
  const commandId = asCommandId(`${TEST_COMMAND_PREFIX}:clone:${Date.now()}`);
  const definition: CommandDefinition = {
    id: commandId,
    kind: 'frontend',
    metadata: {
      title: 'Clone Test Command',
      category: 'clone-test',
      keywords: ['a', 'b']
    },
    argsSchema: {
      type: 'object',
      properties: {
        enabled: {type: 'boolean'}
      },
      required: ['enabled'],
      additionalProperties: false
    },
    resultSchema: {
      type: 'object',
      properties: {
        ok: {type: 'boolean'}
      },
      required: ['ok'],
      additionalProperties: false
    }
  };

  register(definition);

  const fromGet = get(commandId);
  expect(fromGet).toEqual(definition);
  if (!fromGet) {
    throw new Error('Expected command to be registered');
  }

  fromGet.defaultWhen = 'mutatedExpression > 0';
  fromGet.metadata.title = 'Mutated Title';
  fromGet.metadata.keywords?.push('mutated');
  const argsSchemaFromGet = fromGet.argsSchema as {properties: {enabled: {type: string}}};
  const resultSchemaFromGet = fromGet.resultSchema as {properties: {ok: {type: string}}};
  argsSchemaFromGet.properties.enabled.type = 'string';
  resultSchemaFromGet.properties.ok.type = 'string';

  const afterMutationGet = get(commandId);
  const afterMutationListEntry = list().find((command) => command.id === commandId);
  expect(afterMutationGet).toEqual(definition);
  expect(afterMutationListEntry).toEqual(definition);

  const firstListEntry = list().find((command) => command.id === commandId);
  const secondListEntry = list().find((command) => command.id === commandId);
  if (!firstListEntry || !secondListEntry) {
    throw new Error('Expected command to be present in list');
  }

  firstListEntry.metadata.title = 'Mutated List Title';
  const argsSchemaFromList = firstListEntry.argsSchema as {properties: {enabled: {type: string}}};
  argsSchemaFromList.properties.enabled.type = 'number';
  expect(secondListEntry).toEqual(definition);
  expect(get(commandId)).toEqual(definition);
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
  expect(invalidResult.error.commandId).toBe(commandId);
  expect(Array.isArray(invalidResult.error.issues)).toBe(true);
  expect(invalidResult.error.issues?.length).toBeGreaterThan(0);
  expect(invalidResult.error.issues?.[0]).toMatchObject({
    instancePath: expect.any(String),
    schemaPath: expect.any(String),
    keyword: expect.any(String),
    message: expect.any(String),
    params: expect.any(Object)
  });

  expect(validateArgs(commandId, {name: 'alpha', count: 2})).toMatchObject({ok: true});
});

test('validateArgs returns structured errors for unknown commands', () => {
  const commandId = `${TEST_COMMAND_PREFIX}:unknown:${Date.now()}`;

  const result = validateArgs(commandId, {name: 'alpha'});
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('Expected unknown command validation to fail');
  }

  expect(result.error.code).toBe('COMMAND_NOT_FOUND');
  expect(result.error.commandId).toBe(commandId);
});

test('shouldPreventDefault keeps Electron role commands unblocked', () => {
  expect(shouldPreventDefault('editor:copy')).toBe(false);
  expect(shouldPreventDefault('window:toggleFullScreen')).toBe(false);
  expect(shouldPreventDefault('tab:new')).toBe(true);
});
