/** @file Covers command-registry validation edge cases and cache invalidation. */
import {afterAll, beforeAll, beforeEach, expect, mock, test} from 'bun:test';
import type {CommandDefinition, CommandId} from '@shared/types/commands';

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

let register: typeof import('../../lib/command-registry').register;
let update: typeof import('../../lib/command-registry').update;
let remove: typeof import('../../lib/command-registry').remove;
let list: typeof import('../../lib/command-registry').list;
let validateArgs: typeof import('../../lib/command-registry').validateArgs;

const TEST_COMMAND_PREFIX = 'test:command-registry:validation';
const asCommandId = (value: string): CommandId => value as CommandId;
const previousWindow = (globalThis as {window?: Record<string, unknown>}).window;

const createCommandDefinition = (commandId: string, argsSchema?: Record<string, unknown>): CommandDefinition => ({
  id: asCommandId(commandId),
  kind: 'frontend',
  metadata: {
    title: commandId
  },
  argsSchema
});

beforeAll(async () => {
  (globalThis as {window?: Record<string, unknown>}).window = {};

  ({register, update, remove, list, validateArgs} = await import(
    '../../lib/command-registry.ts?command_registry_validation_unit'
  ));
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
  decoratedKeymaps = {};
  runtimeCommands = [];

  list()
    .filter((command) => command.id.startsWith(TEST_COMMAND_PREFIX))
    .forEach((command) => {
      remove(command.id);
    });
});

test('validateArgs reports invalid command schemas clearly', () => {
  const commandId = `${TEST_COMMAND_PREFIX}:invalid-schema`;
  register(
    createCommandDefinition(commandId, {
      type: 'object',
      properties: {
        enabled: {type: 'wat'}
      }
    })
  );

  const result = validateArgs(commandId, {enabled: true});

  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('Expected invalid schema compilation to fail');
  }

  expect(result.error.code).toBe('INVALID_COMMAND_SCHEMA');
  expect(result.error.commandId).toBe(commandId);
  expect(result.error.message).toContain('schema');
});

test('validateArgs returns all actionable issues for invalid payloads', () => {
  const commandId = `${TEST_COMMAND_PREFIX}:multi-issue`;
  register(
    createCommandDefinition(commandId, {
      type: 'object',
      properties: {
        name: {type: 'string'},
        count: {type: 'integer', minimum: 1}
      },
      required: ['name', 'count'],
      additionalProperties: false
    })
  );

  const result = validateArgs(commandId, {count: 0, extra: true});

  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('Expected invalid payload to fail validation');
  }

  const issueKeywords = (result.error.issues ?? []).map((issue) => issue.keyword).sort();
  expect(issueKeywords).toEqual(['additionalProperties', 'minimum', 'required']);
});

interface SchemaChangeScenario {
  commandId: string;
  initialSchema: Record<string, unknown>;
  initialValidPayload: Record<string, unknown>;
  mutate: () => void;
  updatedValidPayload: Record<string, unknown>;
}

const assertCacheIsInvalidatedAfterSchemaChange = (scenario: SchemaChangeScenario): void => {
  const {commandId, initialSchema, initialValidPayload, mutate, updatedValidPayload} = scenario;
  register(createCommandDefinition(commandId, initialSchema));
  expect(validateArgs(commandId, initialValidPayload)).toMatchObject({ok: true});
  mutate();
  const stalePayloadResult = validateArgs(commandId, initialValidPayload);
  expect(stalePayloadResult.ok).toBe(false);
  expect(validateArgs(commandId, updatedValidPayload)).toMatchObject({ok: true});
};

test('update invalidates cached validators when schemas change', () => {
  const commandId = `${TEST_COMMAND_PREFIX}:update-cache`;
  const updatedSchema = {
    type: 'object',
    properties: {
      enabled: {type: 'integer'}
    },
    required: ['enabled'],
    additionalProperties: false
  };

  assertCacheIsInvalidatedAfterSchemaChange({
    commandId,
    initialSchema: {
      type: 'object',
      properties: {
        enabled: {type: 'boolean'}
      },
      required: ['enabled'],
      additionalProperties: false
    },
    initialValidPayload: {enabled: true},
    mutate: () => update(createCommandDefinition(commandId, updatedSchema)),
    updatedValidPayload: {enabled: 1}
  });
});

test('remove clears cached validators before re-registering a command id', () => {
  const commandId = `${TEST_COMMAND_PREFIX}:remove-cache`;
  const updatedSchema = {
    type: 'object',
    properties: {
      enabled: {type: 'integer'}
    },
    required: ['enabled'],
    additionalProperties: false
  };

  assertCacheIsInvalidatedAfterSchemaChange({
    commandId,
    initialSchema: {
      type: 'object',
      properties: {
        enabled: {type: 'string'}
      },
      required: ['enabled'],
      additionalProperties: false
    },
    initialValidPayload: {enabled: 'yes'},
    mutate: () => {
      expect(remove(commandId)).toBe(true);
      register(createCommandDefinition(commandId, updatedSchema));
    },
    updatedValidPayload: {enabled: 7}
  });
});
