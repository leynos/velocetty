/** @file Verifies command-registry keymap and handler behaviour. */
import {expect, mock, test} from 'bun:test';
import type {CommandDefinition, CommandId} from '@shared/types/commands';
import {goldenPathCommandDefinition, GOLDEN_PATH_COMMAND_ID} from '@shared/runtime/golden-path-demo';
import {shouldPreventDefault} from '../../lib/command-registry';

const asCommandId = (value: string): CommandId => value as CommandId;
const TEST_COMMAND_PREFIX = 'test:command-registry';

let moduleInstanceCounter = 0;

type CommandRegistryTestHarness = {
  cleanup: () => void;
  invokeMock: ReturnType<typeof mock<(channel: string) => Promise<unknown>>>;
  setDecoratedKeymaps: (keymaps: Record<string, string[]>) => void;
  setRuntimeCommands: (commands: CommandDefinition[]) => void;
} & typeof import('../../lib/command-registry');

const createCommandRegistryTestHarness = async (): Promise<CommandRegistryTestHarness> => {
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

  moduleInstanceCounter += 1;
  const {createCommandRegistryModule, closeSearchAction, shouldPreventDefault} = await import(
    `../../lib/command-registry.ts?command_registry_test=${moduleInstanceCounter}`
  );

  const moduleInstance = createCommandRegistryModule({
    closeSearch: closeSearchAction,
    focusActiveTerm: () => {},
    transport: {
      invoke: invokeMock
    }
  });

  return {
    ...moduleInstance,
    // Intentionally no-op: DI means no module-level state was mutated.
    cleanup: () => {},
    invokeMock,
    setDecoratedKeymaps: (keymaps) => {
      decoratedKeymaps = keymaps;
    },
    setRuntimeCommands: (commands) => {
      runtimeCommands = commands;
    },
    shouldPreventDefault
  };
};

const createCommandDefinition = (commandId: string, title = commandId): CommandDefinition => ({
  id: asCommandId(commandId),
  kind: 'frontend',
  metadata: {
    title
  }
});

test('getRegisteredKeys flattens decorated keymaps into shortcut-command pairs', async () => {
  const harness = await createCommandRegistryTestHarness();
  try {
    harness.setDecoratedKeymaps({
      'window:new': ['ctrl+shift+n', 'ctrl+alt+n'],
      'tab:new': ['ctrl+t']
    });

    const registeredKeys = await harness.getRegisteredKeys();

    expect(harness.invokeMock).toHaveBeenCalledWith('getDecoratedKeymaps');
    expect(registeredKeys).toEqual({
      'ctrl+shift+n': 'window:new',
      'ctrl+alt+n': 'window:new',
      'ctrl+t': 'tab:new'
    });
  } finally {
    harness.cleanup();
  }
});

test('getRegisteredKeys synchronizes runtime plugin command registrations', async () => {
  const harness = await createCommandRegistryTestHarness();
  try {
    const nonRuntimeCommandId = `${TEST_COMMAND_PREFIX}:non-runtime`;
    harness.register(createCommandDefinition(nonRuntimeCommandId, 'Non-runtime command'));

    harness.setRuntimeCommands([{...goldenPathCommandDefinition}]);
    harness.setDecoratedKeymaps({
      [GOLDEN_PATH_COMMAND_ID]: ['ctrl+alt+shift+g']
    });

    const registeredKeys = await harness.getRegisteredKeys();
    expect(registeredKeys['ctrl+alt+shift+g']).toBe(GOLDEN_PATH_COMMAND_ID);
    expect(harness.get(GOLDEN_PATH_COMMAND_ID)).toEqual(goldenPathCommandDefinition);
    expect(harness.get(nonRuntimeCommandId)).toEqual(
      createCommandDefinition(nonRuntimeCommandId, 'Non-runtime command')
    );

    harness.setRuntimeCommands([]);
    harness.setDecoratedKeymaps({});
    await harness.getRegisteredKeys();

    expect(harness.get(GOLDEN_PATH_COMMAND_ID)).toBeUndefined();
    expect(harness.get(nonRuntimeCommandId)).toEqual(
      createCommandDefinition(nonRuntimeCommandId, 'Non-runtime command')
    );
  } finally {
    harness.cleanup();
  }
});

test('registerCommandHandlers merges new handlers into registry', async () => {
  const harness = await createCommandRegistryTestHarness();
  try {
    const commandName = `test:command:${Date.now()}`;
    const handler = () => {};

    harness.registerCommandHandlers({
      [commandName]: handler
    } as Record<string, (event: unknown, dispatch: unknown) => void>);

    expect(harness.getCommandHandler(commandName)).toBe(handler);
    expect(harness.getCommandHandler('editor:search-close')).toBeFunction();
  } finally {
    harness.cleanup();
  }
});

test('registry CRUD supports deterministic command enumeration', async () => {
  const harness = await createCommandRegistryTestHarness();
  try {
    const commandA = `${TEST_COMMAND_PREFIX}:a`;
    const commandB = `${TEST_COMMAND_PREFIX}:b`;
    const commandC = `${TEST_COMMAND_PREFIX}:c`;

    harness.register(createCommandDefinition(commandB, 'Command B'));
    harness.register(createCommandDefinition(commandA, 'Command A'));
    harness.register(createCommandDefinition(commandC, 'Command C'));
    harness.update(createCommandDefinition(commandC, 'Command C Updated'));
    harness.remove(commandB);
    harness.register(createCommandDefinition(commandB, 'Command B Re-added'));

    const sequenceA = harness
      .list()
      .filter((command) => command.id.startsWith(TEST_COMMAND_PREFIX))
      .map((command) => command.id);

    harness.remove(commandA);
    harness.remove(commandB);
    harness.remove(commandC);

    harness.register(createCommandDefinition(commandC, 'Command C'));
    harness.register(createCommandDefinition(commandB, 'Command B'));
    harness.register(createCommandDefinition(commandA, 'Command A'));
    harness.remove(commandB);
    harness.update(createCommandDefinition(commandC, 'Command C Updated'));
    harness.register(createCommandDefinition(commandB, 'Command B Re-added'));

    const sequenceB = harness
      .list()
      .filter((command) => command.id.startsWith(TEST_COMMAND_PREFIX))
      .map((command) => command.id);

    expect(sequenceA).toEqual(sequenceB);
    expect(sequenceA).toEqual([commandA, commandB, commandC]);
  } finally {
    harness.cleanup();
  }
});

test('registry CRUD supports create/get/update/has/remove semantics', async () => {
  const harness = await createCommandRegistryTestHarness();
  try {
    const commandId = `${TEST_COMMAND_PREFIX}:crud:${Date.now()}`;
    const definition = createCommandDefinition(commandId, 'Initial Title');

    expect(harness.has(commandId)).toBe(false);
    expect(harness.get(commandId)).toBeUndefined();

    harness.register(definition);
    expect(harness.has(commandId)).toBe(true);
    expect(harness.get(commandId)).toEqual(definition);
    expect(
      harness
        .list()
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
    harness.update(updatedDefinition);
    expect(harness.get(commandId)).toEqual(updatedDefinition);
    expect(harness.list().find((command) => command.id === commandId)).toEqual(updatedDefinition);

    expect(harness.remove(commandId)).toBe(true);
    expect(harness.remove(commandId)).toBe(false);
    expect(harness.has(commandId)).toBe(false);
    expect(harness.get(commandId)).toBeUndefined();
    expect(harness.list().some((command) => command.id === commandId)).toBe(false);
  } finally {
    harness.cleanup();
  }
});

test('commandRegistry facade mirrors top-level CRUD behaviour', async () => {
  const harness = await createCommandRegistryTestHarness();
  try {
    const commandId = `${TEST_COMMAND_PREFIX}:facade:${Date.now()}`;
    const definition = createCommandDefinition(commandId, 'Facade Command');

    expect(harness.has(commandId)).toBe(false);
    expect(harness.get(commandId)).toBeUndefined();

    harness.commandRegistry.register(definition);
    expect(harness.commandRegistry.has(commandId)).toBe(true);
    expect(harness.commandRegistry.get(commandId)).toEqual(definition);
    expect(harness.has(commandId)).toBe(true);
    expect(harness.get(commandId)).toEqual(definition);

    const updatedDefinition = {
      ...definition,
      metadata: {
        title: 'Facade Command Updated'
      }
    };

    harness.commandRegistry.update(updatedDefinition);
    expect(harness.commandRegistry.get(commandId)).toEqual(updatedDefinition);
    expect(harness.get(commandId)).toEqual(updatedDefinition);

    const facadeListIds = harness.commandRegistry
      .list()
      .filter((command) => command.id.startsWith(TEST_COMMAND_PREFIX))
      .map((command) => command.id);

    const topLevelListIds = harness
      .list()
      .filter((command) => command.id.startsWith(TEST_COMMAND_PREFIX))
      .map((command) => command.id);

    expect(facadeListIds).toEqual(topLevelListIds);
    expect(facadeListIds).toContain(commandId);
    expect(harness.commandRegistry.validateArgs(commandId, {})).toMatchObject({ok: true});

    harness.commandRegistry.remove(commandId);
    expect(harness.commandRegistry.has(commandId)).toBe(false);
    expect(harness.commandRegistry.get(commandId)).toBeUndefined();
    expect(harness.has(commandId)).toBe(false);
    expect(harness.get(commandId)).toBeUndefined();
  } finally {
    harness.cleanup();
  }
});

test('get/list defensively clone schema and metadata definitions', async () => {
  const harness = await createCommandRegistryTestHarness();
  try {
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

    harness.register(definition);

    const fromGet = harness.get(commandId);
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

    const afterMutationGet = harness.get(commandId);
    const afterMutationListEntry = harness.list().find((command) => command.id === commandId);
    expect(afterMutationGet).toEqual(definition);
    expect(afterMutationListEntry).toEqual(definition);

    const firstListEntry = harness.list().find((command) => command.id === commandId);
    const secondListEntry = harness.list().find((command) => command.id === commandId);
    if (!firstListEntry || !secondListEntry) {
      throw new Error('Expected command to be present in list');
    }

    firstListEntry.metadata.title = 'Mutated List Title';
    const argsSchemaFromList = firstListEntry.argsSchema as {properties: {enabled: {type: string}}};
    argsSchemaFromList.properties.enabled.type = 'number';
    expect(secondListEntry).toEqual(definition);
    expect(harness.get(commandId)).toEqual(definition);
  } finally {
    harness.cleanup();
  }
});

test('validateArgs returns structured errors for invalid command arguments', async () => {
  const harness = await createCommandRegistryTestHarness();
  try {
    const commandId = `${TEST_COMMAND_PREFIX}:validate:${Date.now()}`;
    harness.register({
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

    const invalidResult = harness.validateArgs(commandId, {name: 'alpha', count: 0});
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

    expect(harness.validateArgs(commandId, {name: 'alpha', count: 2})).toMatchObject({ok: true});
  } finally {
    harness.cleanup();
  }
});

test('validateArgs returns structured errors for unknown commands', async () => {
  const harness = await createCommandRegistryTestHarness();
  try {
    const commandId = `${TEST_COMMAND_PREFIX}:unknown:${Date.now()}`;

    const result = harness.validateArgs(commandId, {name: 'alpha'});
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected unknown command validation to fail');
    }

    expect(result.error.code).toBe('COMMAND_NOT_FOUND');
    expect(result.error.commandId).toBe(commandId);
  } finally {
    harness.cleanup();
  }
});

test('shouldPreventDefault keeps Electron role commands unblocked', () => {
  // shouldPreventDefault is a pure function; no harness needed.
  expect(shouldPreventDefault('editor:copy')).toBe(false);
  expect(shouldPreventDefault('window:toggleFullScreen')).toBe(false);
  expect(shouldPreventDefault('tab:new')).toBe(true);
});
