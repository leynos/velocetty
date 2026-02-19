import type {HyperDispatch} from '../typings/hyper';
import Ajv, {type ErrorObject, type ValidateFunction} from 'ajv';

import {closeSearch} from './actions/sessions';
import {transport} from './transport';

export type CommandId = string;
export type CommandKind = 'frontend' | 'backend';
export type CommandHandler = (event: any, dispatch: HyperDispatch) => void;
export type CommandArgsSchema = Record<string, unknown>;

export interface CommandMetadata {
  title: string;
  category?: string;
  description?: string;
  keywords?: string[];
  icon?: string;
}

export interface CommandDefinition {
  id: CommandId;
  metadata: CommandMetadata;
  kind: CommandKind;
  defaultWhen?: string;
  argsSchema?: CommandArgsSchema;
  resultSchema?: CommandArgsSchema;
}

interface RegisteredCommand extends CommandDefinition {
  handler?: CommandHandler;
}

interface SerializableValidationError {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string;
  params: Record<string, unknown>;
}

export interface CommandValidationError {
  code: 'INVALID_COMMAND_ARGS' | 'COMMAND_NOT_FOUND' | 'INVALID_COMMAND_SCHEMA';
  message: string;
  details: {
    commandId: CommandId;
    errors?: SerializableValidationError[];
  };
}

export type CommandValidationResult = {ok: true} | {ok: false; error: CommandValidationError};

export interface CommandRegistry {
  register(definition: CommandDefinition, handler?: CommandHandler): void;
  update(definition: CommandDefinition, handler?: CommandHandler): void;
  remove(commandId: CommandId): boolean;
  get(commandId: CommandId): CommandDefinition | undefined;
  list(): CommandDefinition[];
  has(commandId: CommandId): boolean;
  validateArgs(commandId: CommandId, args: unknown): CommandValidationResult;
}

const compareByCommandId = (left: CommandDefinition, right: CommandDefinition) => left.id.localeCompare(right.id);

const createLegacyDefinition = (id: CommandId): CommandDefinition => ({
  id,
  kind: 'frontend',
  metadata: {
    title: id
  }
});

const cloneCommandDefinition = (command: RegisteredCommand): CommandDefinition => ({
  id: command.id,
  metadata: {
    ...command.metadata
  },
  kind: command.kind,
  defaultWhen: command.defaultWhen,
  argsSchema: command.argsSchema,
  resultSchema: command.resultSchema
});

const serializeAjvErrors = (errors: ErrorObject[] | null | undefined): SerializableValidationError[] =>
  (errors ?? []).map((error) => ({
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message ?? 'Schema validation failed',
    params: error.params as Record<string, unknown>
  }));

const ajv = new Ajv({allErrors: true, strict: false});
const validatorsByCommandId = new Map<CommandId, ValidateFunction>();
const registry = new Map<CommandId, RegisteredCommand>();

const upsertCommand = (definition: CommandDefinition, handler?: CommandHandler) => {
  const existingCommand = registry.get(definition.id);

  registry.set(definition.id, {
    ...existingCommand,
    ...definition,
    metadata: {
      ...definition.metadata
    },
    handler: handler ?? existingCommand?.handler
  });

  validatorsByCommandId.delete(definition.id);
};

const assignLegacyHandler = (commandId: CommandId, handler: CommandHandler) => {
  const existingCommand = registry.get(commandId);
  if (existingCommand) {
    registry.set(commandId, {
      ...existingCommand,
      handler
    });
    return;
  }

  registry.set(commandId, {
    ...createLegacyDefinition(commandId),
    handler
  });
};

const runCommandArgsValidation = (commandId: CommandId, args: unknown): CommandValidationResult => {
  const command = registry.get(commandId);
  if (!command) {
    return {
      ok: false,
      error: {
        code: 'COMMAND_NOT_FOUND',
        message: `Cannot validate args for unknown command: ${commandId}`,
        details: {
          commandId
        }
      }
    };
  }

  if (!command.argsSchema) {
    return {ok: true};
  }

  try {
    let validator = validatorsByCommandId.get(commandId);
    if (!validator) {
      validator = ajv.compile(command.argsSchema);
      validatorsByCommandId.set(commandId, validator);
    }

    if (validator(args)) {
      return {ok: true};
    }

    return {
      ok: false,
      error: {
        code: 'INVALID_COMMAND_ARGS',
        message: `Invalid args for command: ${commandId}`,
        details: {
          commandId,
          errors: serializeAjvErrors(validator.errors)
        }
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'INVALID_COMMAND_SCHEMA',
        message: error instanceof Error ? error.message : `Invalid schema for command: ${commandId}`,
        details: {
          commandId
        }
      }
    };
  }
};

assignLegacyHandler('editor:search-close', (e, dispatch) => {
  dispatch(closeSearch(undefined, e));
  window.focusActiveTerm();
});

export const register = (definition: CommandDefinition, handler?: CommandHandler) => {
  upsertCommand(definition, handler);
};

export const update = (definition: CommandDefinition, handler?: CommandHandler) => {
  upsertCommand(definition, handler);
};

export const remove = (commandId: CommandId) => {
  validatorsByCommandId.delete(commandId);
  return registry.delete(commandId);
};

export const get = (commandId: CommandId) => {
  const command = registry.get(commandId);
  return command ? cloneCommandDefinition(command) : undefined;
};

export const list = () => {
  return Array.from(registry.values()).map(cloneCommandDefinition).sort(compareByCommandId);
};

export const has = (commandId: CommandId) => {
  return registry.has(commandId);
};

export const validateArgs = (commandId: CommandId, args: unknown) => {
  return runCommandArgsValidation(commandId, args);
};

export const registerCommand = register;
export const createCommand = register;
export const updateCommand = update;
export const replaceCommand = update;
export const removeCommand = remove;
export const deleteCommand = remove;
export const getCommand = get;
export const getCommandDefinition = get;
export const listCommands = list;
export const enumerateCommands = list;
export const hasCommand = has;
export const hasCommandDefinition = has;
export const validateCommandArgs = validateArgs;
export const validateCommandArgsFor = validateArgs;

export const commandRegistry: CommandRegistry = {
  register,
  update,
  remove,
  get,
  list,
  has,
  validateArgs
};

export const getRegisteredKeys = async () => {
  const keymaps = await transport.invoke('getDecoratedKeymaps');

  return Object.keys(keymaps).reduce((result: Record<string, string>, actionName) => {
    const commandKeys = keymaps[actionName];
    commandKeys.forEach((shortcut) => {
      result[shortcut] = actionName;
    });
    return result;
  }, {});
};

export const registerCommandHandlers = (cmds: Record<string, CommandHandler> | undefined) => {
  if (!cmds) {
    return;
  }

  Object.keys(cmds).forEach((commandId) => {
    assignLegacyHandler(commandId, cmds[commandId]);
  });
};

export const getCommandHandler = (command: string) => {
  return registry.get(command)?.handler;
};

// Some commands are directly excuted by Electron menuItem role.
// They should not be prevented to reach Electron.
const roleCommands = [
  'window:close',
  'editor:undo',
  'editor:redo',
  'editor:cut',
  'editor:copy',
  'editor:paste',
  'editor:selectAll',
  'window:minimize',
  'window:zoom',
  'window:toggleFullScreen'
];

export const shouldPreventDefault = (command: string) => !roleCommands.includes(command);
