import type {HyperDispatch} from '../typings/hyper';
import type {
  CommandDefinition,
  CommandId,
  CommandOrderingComparator,
  CommandRegistry,
  CommandValidationError,
  CommandValidationIssue,
  CommandValidationResult
} from '@shared/types/commands';
import Ajv, {type ErrorObject, type ValidateFunction} from 'ajv';

import {closeSearch} from './actions/sessions';
import {transport} from './transport';

export type CommandHandler = (event: any, dispatch: HyperDispatch) => void;

interface RegisteredCommand extends CommandDefinition {
  handler?: CommandHandler;
}

const compareByCommandId: CommandOrderingComparator = (left, right) => left.id.localeCompare(right.id);

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
    ...command.metadata,
    keywords: command.metadata.keywords ? [...command.metadata.keywords] : undefined
  },
  kind: command.kind,
  defaultWhen: command.defaultWhen,
  argsSchema: command.argsSchema,
  resultSchema: command.resultSchema
});

const serializeAjvErrors = (errors: ErrorObject[] | null | undefined): CommandValidationIssue[] =>
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
    const error: CommandValidationError = {
      code: 'COMMAND_NOT_FOUND',
      commandId,
      target: 'args',
      message: `Cannot validate args for unknown command: ${commandId}`
    };
    return {
      ok: false,
      error
    };
  }

  if (!command.argsSchema) {
    return {ok: true, value: args};
  }

  try {
    let validator = validatorsByCommandId.get(commandId);
    if (!validator) {
      validator = ajv.compile(command.argsSchema);
      validatorsByCommandId.set(commandId, validator);
    }

    if (validator(args)) {
      return {ok: true, value: args};
    }

    const error: CommandValidationError = {
      code: 'INVALID_COMMAND_ARGS',
      commandId,
      target: 'args',
      message: `Invalid args for command: ${commandId}`,
      issues: serializeAjvErrors(validator.errors)
    };
    return {
      ok: false,
      error
    };
  } catch (error) {
    const validationError: CommandValidationError = {
      code: 'INVALID_COMMAND_SCHEMA',
      commandId,
      target: 'args',
      message: error instanceof Error ? error.message : `Invalid schema for command: ${commandId}`
    };
    return {
      ok: false,
      error: validationError
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

export const commandRegistry: CommandRegistry<CommandHandler> = {
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

// Some commands are directly executed by Electron menuItem role.
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
