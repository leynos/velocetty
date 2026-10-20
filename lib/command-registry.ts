/** @file Command registry and validation helpers for renderer command dispatch. */
import type {RendererCommandTransport} from '@shared/types/transport';
import type {HyperDispatch, HyperState} from '../typings/hyper';
import type {IpcCommands} from '@shared/types/common';
import {
  asCommandId,
  type CommandDefinition,
  type CommandId,
  type CommandOrderingComparator,
  type CommandRegistry,
  type CommandValidationError,
  type CommandValidationIssue,
  type CommandValidationResult
} from '@shared/types/commands';
import {SESSION_SEARCH} from '@shared/constants/sessions';
import {asSessionId} from '@shared/types/common';
import Ajv, {type ErrorObject, type ValidateFunction} from 'ajv';
import {isBoolean, isObject} from '@shared/types/guards';
import {isJsonObject} from '@shared/types/json';

export type CommandHandler = (event: unknown, dispatch: HyperDispatch) => void;

interface RegisteredCommand extends CommandDefinition {
  handler?: CommandHandler;
}

type CommandRegistryDependencies = {
  closeSearch: (
    uid?: string,
    keyEvent?: {catched?: boolean}
  ) => (dispatch: HyperDispatch, getState: () => HyperState) => void;
  focusActiveTerm: () => void;
  transport: Pick<RendererCommandTransport, 'invoke'>;
};

const compareByCommandId: CommandOrderingComparator = (left, right) => {
  if (left.id < right.id) {
    return -1;
  }
  if (left.id > right.id) {
    return 1;
  }
  return 0;
};
const cloneSchema = <TSchema>(schema: TSchema | undefined): TSchema | undefined => {
  if (!schema) {
    return schema;
  }

  return structuredClone(schema);
};

const createLegacyDefinition = (id: CommandId): CommandDefinition => ({
  id,
  kind: 'frontend',
  metadata: {
    title: id
  }
});

export const closeSearchAction = (uid?: string, keyEvent?: {catched?: boolean}) => {
  return (dispatch: HyperDispatch, getState: () => HyperState) => {
    const targetUid = uid ?? getState().sessions.activeUid;
    if (!targetUid) {
      // No active session yet — propagate the key event and bail.
      if (keyEvent) {
        keyEvent.catched = false;
      }
      return;
    }

    if (getState().sessions.sessions[targetUid]?.search) {
      dispatch({
        type: SESSION_SEARCH,
        uid: asSessionId(targetUid),
        value: false
      });
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

/** Accepts an optional path string and normalizes it to a guaranteed string. */
const asIssuePath = (value: string | undefined): string => value ?? '';

const serializeAjvErrors = (errors: ErrorObject[] | null | undefined): CommandValidationIssue[] =>
  (errors ?? []).map((error) => {
    return {
      instancePath: asIssuePath(error.dataPath),
      schemaPath: asIssuePath(error.schemaPath),
      keyword: error.keyword,
      message: error.message ?? 'Schema validation failed',
      params: isJsonObject(error.params) ? error.params : {}
    };
  });

const isSearchKeyEvent = (candidate: unknown): candidate is {catched?: boolean} =>
  isObject(candidate) && (!('catched' in candidate) || isBoolean(candidate.catched));

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
    return [...registry.values()].map((definition) => cloneCommandDefinition(definition)).toSorted(compareByCommandId);
  };

  const has = (commandId: CommandId | string) => {
    return registry.has(asCommandId(commandId));
  };

  const getCommandHandler = (command: CommandId | string) => {
    return registry.get(asCommandId(command))?.handler;
  };

  const registerCommandHandlers = (cmds: Partial<Record<string, CommandHandler>> | undefined) => {
    if (!cmds) {
      return;
    }

    Object.keys(cmds).forEach((commandId) => {
      const handler = cmds[commandId];
      if (!handler) {
        return;
      }
      assignLegacyHandler(asCommandId(commandId), handler);
    });
  };

  const getRegisteredKeys = async () => {
    const runtimeCommands = await dependencies.transport.invoke('getRuntimePluginCommands');
    syncRuntimePluginCommands(runtimeCommands);
    const keymaps = await dependencies.transport.invoke('getDecoratedKeymaps');

    const result: Record<string, string> = {};
    for (const actionName of Object.keys(keymaps)) {
      const commandKeys = keymaps[actionName];
      commandKeys.forEach((shortcut) => {
        result[shortcut] = actionName;
      });
    }
    return result;
  };

  assignLegacyHandler(asCommandId('editor:search-close'), (e, dispatch) => {
    dispatch(dependencies.closeSearch(undefined, isSearchKeyEvent(e) ? e : undefined));
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
  closeSearch: closeSearchAction,
  focusActiveTerm: () => {
    if (globalThis.focusActiveTerm) {
      globalThis.focusActiveTerm();
    }
  },
  transport: {
    invoke: async <Command extends keyof IpcCommands>(channel: Command, ...args: Parameters<IpcCommands[Command]>) => {
      const {transport} = await import('./transport');
      // Forward all args to avoid silently dropping IpcCommands payload args.
      return transport.invoke(channel, ...args);
    }
  }
});

/** Core CRUD and validation API. */
export const {validateArgs, register, update, remove, get, list, has} = commandRegistryModule;

/** Public `CommandRegistry<CommandHandler>` entry point with CRUD and validation APIs. */
export const commandRegistry: CommandRegistry<CommandHandler> = commandRegistryModule.commandRegistry;

/** Async key resolution, handler management, and bulk registration. */
export const {getRegisteredKeys, registerCommandHandlers, getCommandHandler} = commandRegistryModule;

/** Compat aliases — retained for call sites that use legacy command-verb naming. */
export const {
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
} = commandRegistryModule;

// Some commands are directly executed by Electron menuItem role.
// They should not be prevented to reach Electron.
const roleCommands = new Set([
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
]);

export const shouldPreventDefault = (command: string) => !roleCommands.has(command);
