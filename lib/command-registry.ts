/** @file Command registry and validation helpers for renderer command dispatch. */
import type {RendererCommandTransport} from '@shared/types/transport';
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
import {SESSION_SEARCH} from '@shared/constants/sessions';
import Ajv, {type ErrorObject, type ValidateFunction} from 'ajv';

export type CommandHandler = (event: unknown, dispatch: HyperDispatch) => void;

interface RegisteredCommand extends CommandDefinition {
  handler?: CommandHandler;
}

type CommandRegistryDependencies = {
  focusActiveTerm: () => void;
  transport: Pick<RendererCommandTransport, 'invoke'>;
};

const compareByCommandId: CommandOrderingComparator = (left, right) =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
const asCommandId = (value: string | CommandId): CommandId => value as CommandId;
const cloneSchema = <TSchema>(schema: TSchema | undefined): TSchema | undefined => {
  if (!schema) {
    return schema;
  }

  return JSON.parse(JSON.stringify(schema)) as TSchema;
};

const createLegacyDefinition = (id: CommandId): CommandDefinition => ({
  id,
  kind: 'frontend',
  metadata: {
    title: id
  }
});

const closeSearchAction = (uid?: string, keyEvent?: {catched?: boolean}) => {
  return (
    dispatch: HyperDispatch,
    getState: () => {sessions: {activeUid: string; sessions: Record<string, {search?: boolean}>}}
  ) => {
    const targetUid = uid || getState().sessions.activeUid;
    if (getState().sessions.sessions[targetUid]?.search) {
      dispatch({
        type: SESSION_SEARCH,
        uid: targetUid,
        value: false
      } as never);
      return;
    }

    if (keyEvent) {
      keyEvent.catched = false;
    }
  };
};

const cloneCommandDefinition = (command: RegisteredCommand): CommandDefinition => ({
  id: command.id,
  metadata: {
    ...command.metadata,
    keywords: command.metadata.keywords ? [...command.metadata.keywords] : undefined
  },
  kind: command.kind,
  defaultWhen: command.defaultWhen,
  argsSchema: cloneSchema(command.argsSchema),
  resultSchema: cloneSchema(command.resultSchema)
});

/** Extends Ajv ErrorObject with legacy v6 path fields for instance/data paths. */
type AjvErrorWithLegacyPath = ErrorObject & {
  instancePath?: string;
  dataPath?: string;
};

/** Accepts an optional path string and normalizes it to a guaranteed string. */
const asIssuePath = (value: string | undefined): string => (typeof value === 'string' ? value : '');
/** Coerces unknown params into a Record<string, unknown> or an empty object. */
const asIssueParams = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const serializeAjvErrors = (errors: ErrorObject[] | null | undefined): CommandValidationIssue[] =>
  (errors ?? []).map((error) => {
    const maybeLegacyError = error as AjvErrorWithLegacyPath;
    const instancePath = asIssuePath(maybeLegacyError.instancePath) || asIssuePath(maybeLegacyError.dataPath);

    return {
      instancePath,
      schemaPath: asIssuePath(error.schemaPath),
      keyword: error.keyword,
      message: error.message ?? 'Schema validation failed',
      params: asIssueParams(error.params)
    };
  });

export const createCommandRegistryModule = (dependencies: CommandRegistryDependencies) => {
  const ajv = new Ajv({allErrors: true});
  const validatorsByCommandId = new Map<CommandId, ValidateFunction>();
  const registry = new Map<CommandId, RegisteredCommand>();
  const runtimeManagedCommands = new Set<CommandId>();

  const upsertCommand = (definition: CommandDefinition, handler?: CommandHandler) => {
    const existingCommand = registry.get(definition.id);

    registry.set(definition.id, {
      ...existingCommand,
      ...definition,
      metadata: {
        ...definition.metadata,
        keywords: definition.metadata.keywords ? [...definition.metadata.keywords] : undefined
      },
      argsSchema: cloneSchema(definition.argsSchema),
      resultSchema: cloneSchema(definition.resultSchema),
      handler: handler ?? existingCommand?.handler
    });

    validatorsByCommandId.delete(definition.id);
  };

  const remove = (commandId: CommandId | string) => {
    const commandKey = asCommandId(commandId);
    validatorsByCommandId.delete(commandKey);
    return registry.delete(commandKey);
  };

  const assignLegacyHandler = (commandId: CommandId, handler: CommandHandler) => {
    const definition = registry.get(commandId) ?? createLegacyDefinition(commandId);
    upsertCommand(definition, handler);
  };

  const syncRuntimePluginCommands = (runtimeCommands: CommandDefinition[]) => {
    const activeRuntimeCommands = new Set<CommandId>();

    runtimeCommands.forEach((command) => {
      const commandId = asCommandId(command.id);
      upsertCommand({...command, id: commandId});
      activeRuntimeCommands.add(commandId);
    });

    runtimeManagedCommands.forEach((commandId) => {
      if (!activeRuntimeCommands.has(commandId)) {
        remove(commandId);
      }
    });

    runtimeManagedCommands.clear();
    activeRuntimeCommands.forEach((commandId) => {
      runtimeManagedCommands.add(commandId);
    });
  };

  const validateArgs = (commandId: CommandId | string, args: unknown): CommandValidationResult => {
    const commandKey = asCommandId(commandId);
    const command = registry.get(commandKey);
    if (!command) {
      const error: CommandValidationError = {
        code: 'COMMAND_NOT_FOUND',
        commandId: commandKey,
        target: 'args',
        message: `Cannot validate args for unknown command: ${commandKey}`
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
      let validator = validatorsByCommandId.get(commandKey);
      if (!validator) {
        validator = ajv.compile(command.argsSchema);
        validatorsByCommandId.set(commandKey, validator);
      }

      if (validator(args)) {
        return {ok: true, value: args};
      }

      const error: CommandValidationError = {
        code: 'INVALID_COMMAND_ARGS',
        commandId: commandKey,
        target: 'args',
        message: `Invalid args for command: ${commandKey}`,
        issues: serializeAjvErrors(validator.errors)
      };
      return {
        ok: false,
        error
      };
    } catch (error) {
      const validationError: CommandValidationError = {
        code: 'INVALID_COMMAND_SCHEMA',
        commandId: commandKey,
        target: 'args',
        message: error instanceof Error ? error.message : `Invalid schema for command: ${commandKey}`
      };
      return {
        ok: false,
        error: validationError
      };
    }
  };

  const get = (commandId: CommandId | string) => {
    const command = registry.get(asCommandId(commandId));
    return command ? cloneCommandDefinition(command) : undefined;
  };

  const list = () => {
    return Array.from(registry.values()).map(cloneCommandDefinition).sort(compareByCommandId);
  };

  const has = (commandId: CommandId | string) => {
    return registry.has(asCommandId(commandId));
  };

  const getCommandHandler = (command: CommandId | string) => {
    return registry.get(asCommandId(command))?.handler;
  };

  const registerCommandHandlers = (cmds: Record<string, CommandHandler> | undefined) => {
    if (!cmds) {
      return;
    }

    Object.keys(cmds).forEach((commandId) => {
      assignLegacyHandler(asCommandId(commandId), cmds[commandId]);
    });
  };

  const getRegisteredKeys = async () => {
    const runtimeCommands = await dependencies.transport.invoke('getRuntimePluginCommands');
    syncRuntimePluginCommands(runtimeCommands);
    const keymaps = await dependencies.transport.invoke('getDecoratedKeymaps');

    return Object.keys(keymaps).reduce((result: Record<string, string>, actionName) => {
      const commandKeys = keymaps[actionName];
      commandKeys.forEach((shortcut) => {
        result[shortcut] = actionName;
      });
      return result;
    }, {});
  };

  assignLegacyHandler(asCommandId('editor:search-close'), (e, dispatch) => {
    dispatch(closeSearchAction(undefined, e as {catched?: boolean}) as never);
    dependencies.focusActiveTerm();
  });

  const register = upsertCommand;
  const update = upsertCommand;
  const registerCommand = register;
  const createCommand = register;
  const updateCommand = update;
  const replaceCommand = update;
  const removeCommand = remove;
  const deleteCommand = remove;
  const getCommand = get;
  const getCommandDefinition = get;
  const listCommands = list;
  const enumerateCommands = list;
  const hasCommand = has;
  const hasCommandDefinition = has;
  const validateCommandArgs = validateArgs;
  const validateCommandArgsFor = validateArgs;

  const commandRegistry: CommandRegistry<CommandHandler> = {
    register,
    update,
    remove,
    get,
    list,
    has,
    validateArgs
  };

  return {
    commandRegistry,
    createCommand,
    deleteCommand,
    enumerateCommands,
    get,
    getCommand,
    getCommandDefinition,
    getCommandHandler,
    getRegisteredKeys,
    has,
    hasCommand,
    hasCommandDefinition,
    list,
    listCommands,
    register,
    registerCommand,
    registerCommandHandlers,
    remove,
    removeCommand,
    replaceCommand,
    update,
    updateCommand,
    validateArgs,
    validateCommandArgs,
    validateCommandArgsFor
  };
};

const commandRegistryModule = createCommandRegistryModule({
  focusActiveTerm: () => window.focusActiveTerm(),
  transport: {
    invoke: async (channel) => {
      const {transport} = await import('./transport');
      return transport.invoke(channel);
    }
  }
});

/**
 * Validates command arguments against a command's registered args schema.
 *
 * Returns `COMMAND_NOT_FOUND` when the command does not exist,
 * `INVALID_COMMAND_SCHEMA` when schema compilation fails, and
 * `INVALID_COMMAND_ARGS` with structured issues when validation fails.
 *
 * @param commandId Command identifier whose args contract should be checked.
 * @param args Candidate argument payload to validate.
 * @returns Validation result containing accepted args or a structured validation error.
 */
export const validateArgs = commandRegistryModule.validateArgs;
/** Registers or updates a command definition with an optional handler. */
export const register = commandRegistryModule.register;
/** Updates a command definition with an optional handler (alias for `register`). */
export const update = commandRegistryModule.update;
/**
 * Removes a command from the registry.
 *
 * @param commandId Command identifier to remove.
 * @returns `true` when the command existed and was removed, otherwise `false`.
 */
export const remove = commandRegistryModule.remove;
/**
 * Retrieves a command definition by identifier.
 *
 * @param commandId Command identifier to retrieve.
 * @returns The registered command definition, or `undefined` when not found.
 */
export const get = commandRegistryModule.get;
/**
 * Lists all registered commands in deterministic order sorted by command ID.
 *
 * @returns All registered command definitions sorted lexically by ID.
 */
export const list = commandRegistryModule.list;
/**
 * Checks whether a command exists in the registry.
 *
 * @param commandId Command identifier to check.
 * @returns `true` when the command exists, otherwise `false`.
 */
export const has = commandRegistryModule.has;

/** Public aliases for the primary registry APIs. */
/** Alias of `register` for command creation workflows. */
export const registerCommand = commandRegistryModule.registerCommand;
/** Alias of `register` retained for legacy compatibility. */
export const createCommand = commandRegistryModule.createCommand;
/** Alias of `update` for explicit update call sites. */
export const updateCommand = commandRegistryModule.updateCommand;
/** Alias of `update` retained for replace semantics. */
export const replaceCommand = commandRegistryModule.replaceCommand;
/** Alias of `remove` for command deletion workflows. */
export const removeCommand = commandRegistryModule.removeCommand;
/** Alias of `remove` retained for legacy delete naming. */
export const deleteCommand = commandRegistryModule.deleteCommand;
/** Alias of `get` for command lookup by identifier. */
export const getCommand = commandRegistryModule.getCommand;
/** Alias of `get` retained for definition-oriented call sites. */
export const getCommandDefinition = commandRegistryModule.getCommandDefinition;
/** Alias of `list` for command enumeration workflows. */
export const listCommands = commandRegistryModule.listCommands;
/** Alias of `list` retained for legacy enumerate naming. */
export const enumerateCommands = commandRegistryModule.enumerateCommands;
/** Alias of `has` for command existence checks. */
export const hasCommand = commandRegistryModule.hasCommand;
/** Alias of `has` retained for definition-oriented call sites. */
export const hasCommandDefinition = commandRegistryModule.hasCommandDefinition;
/** Alias of `validateArgs` for command-args validation helpers. */
export const validateCommandArgs = commandRegistryModule.validateCommandArgs;
/** Alias of `validateArgs` retained for legacy helper naming. */
export const validateCommandArgsFor = commandRegistryModule.validateCommandArgsFor;

/** Public `CommandRegistry<CommandHandler>` entry point with CRUD and validation APIs. */
export const commandRegistry: CommandRegistry<CommandHandler> = commandRegistryModule.commandRegistry;

export const getRegisteredKeys = commandRegistryModule.getRegisteredKeys;
export const registerCommandHandlers = commandRegistryModule.registerCommandHandlers;
export const getCommandHandler = commandRegistryModule.getCommandHandler;

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
