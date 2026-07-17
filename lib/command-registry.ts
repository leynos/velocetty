/** @file Command registry and validation helpers for renderer command dispatch. */
import type {RendererCommandTransport} from '@shared/types/transport';
import type {HyperDispatch, HyperState} from '../typings/hyper';
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

/** A legacy-style command handler invoked with the triggering event and the dispatch function. */
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

/** Requests that the active (or given) session's search be closed, deferring to the terminal if none is open. */
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

/** Builds an isolated command registry module, wiring in legacy search-close and focus dependencies. */
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

    return Object.keys(keymaps).reduce((result: Record<string, string>, actionName) => {
      const commandKeys = keymaps[actionName];
      commandKeys.forEach((shortcut) => {
        result[shortcut] = actionName;
      });
      return result;
    }, {});
  };

  assignLegacyHandler(asCommandId('editor:search-close'), (e, dispatch) => {
    dispatch(dependencies.closeSearch(undefined, e as {catched?: boolean}) as never);
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
    /** Public `CommandRegistry<CommandHandler>` view exposing the core CRUD and validation API. */
    commandRegistry,
    /** Alias of {@link register} for legacy call sites. */
    createCommand,
    /** Alias of {@link remove} for legacy call sites. */
    deleteCommand,
    /** Alias of {@link list} for legacy call sites. */
    enumerateCommands,
    /** Looks up a command definition by id, returning a clone. */
    get,
    /** Alias of {@link get} for legacy call sites. */
    getCommand,
    /** Alias of {@link get} for legacy call sites. */
    getCommandDefinition,
    /** Returns the handler registered for a command id, if any. */
    getCommandHandler,
    /** Syncs runtime plugin commands and resolves the current shortcut-to-action keymap. */
    getRegisteredKeys,
    /** Reports whether a command id is registered. */
    has,
    /** Alias of {@link has} for legacy call sites. */
    hasCommand,
    /** Alias of {@link has} for legacy call sites. */
    hasCommandDefinition,
    /** Lists all registered command definitions, sorted by id. */
    list,
    /** Alias of {@link list} for legacy call sites. */
    listCommands,
    /** Adds or replaces a command definition, clearing any cached validator. */
    register,
    /** Alias of {@link register} for legacy call sites. */
    registerCommand,
    /** Bulk-registers legacy `{commandId: handler}` maps as handlers on existing/legacy definitions. */
    registerCommandHandlers,
    /** Removes a command definition and its cached validator. */
    remove,
    /** Alias of {@link remove} for legacy call sites. */
    removeCommand,
    /** Alias of {@link register} for legacy call sites. */
    replaceCommand,
    /** Alias of {@link register} for legacy call sites. */
    update,
    /** Alias of {@link register} for legacy call sites. */
    updateCommand,
    /** Validates command arguments against the command's compiled JSON schema. */
    validateArgs,
    /** Alias of {@link validateArgs} for legacy call sites. */
    validateCommandArgs,
    /** Alias of {@link validateArgs} for legacy call sites. */
    validateCommandArgsFor
  };
};

const commandRegistryModule = createCommandRegistryModule({
  closeSearch: closeSearchAction,
  focusActiveTerm: () => {
    if (typeof window !== 'undefined' && typeof window.focusActiveTerm === 'function') {
      window.focusActiveTerm();
    }
  },
  transport: {
    invoke: (async (channel: string, ...args: unknown[]) => {
      const {transport} = await import('./transport');
      // Forward all args to avoid silently dropping IpcCommands payload args.
      return (transport.invoke as (c: string, ...a: unknown[]) => Promise<unknown>)(channel, ...args);
    }) as RendererCommandTransport['invoke']
  }
});

/** Core CRUD and validation API. */
export const {
  /** Validates command arguments against the command's compiled JSON schema. */
  validateArgs,
  /** Adds or replaces a command definition, clearing any cached validator. */
  register,
  /** Alias of {@link register} for legacy call sites. */
  update,
  /** Removes a command definition and its cached validator. */
  remove,
  /** Looks up a command definition by id, returning a clone. */
  get,
  /** Lists all registered command definitions, sorted by id. */
  list,
  /** Reports whether a command id is registered. */
  has
} = commandRegistryModule;

/** Public `CommandRegistry<CommandHandler>` entry point with CRUD and validation APIs. */
export const commandRegistry: CommandRegistry<CommandHandler> = commandRegistryModule.commandRegistry;

/** Async key resolution, handler management, and bulk registration. */
export const {
  /** Syncs runtime plugin commands and resolves the current shortcut-to-action keymap. */
  getRegisteredKeys,
  /** Bulk-registers legacy `{commandId: handler}` maps as handlers on existing/legacy definitions. */
  registerCommandHandlers,
  /** Returns the handler registered for a command id, if any. */
  getCommandHandler
} = commandRegistryModule;

/** Compat aliases — retained for call sites that use legacy command-verb naming. */
export const {
  /** Alias of {@link register} for legacy call sites. */
  registerCommand,
  /** Alias of {@link register} for legacy call sites. */
  createCommand,
  /** Alias of {@link register} for legacy call sites. */
  updateCommand,
  /** Alias of {@link register} for legacy call sites. */
  replaceCommand,
  /** Alias of {@link remove} for legacy call sites. */
  removeCommand,
  /** Alias of {@link remove} for legacy call sites. */
  deleteCommand,
  /** Alias of {@link get} for legacy call sites. */
  getCommand,
  /** Alias of {@link get} for legacy call sites. */
  getCommandDefinition,
  /** Alias of {@link list} for legacy call sites. */
  listCommands,
  /** Alias of {@link list} for legacy call sites. */
  enumerateCommands,
  /** Alias of {@link has} for legacy call sites. */
  hasCommand,
  /** Alias of {@link has} for legacy call sites. */
  hasCommandDefinition,
  /** Alias of {@link validateArgs} for legacy call sites. */
  validateCommandArgs,
  /** Alias of {@link validateArgs} for legacy call sites. */
  validateCommandArgsFor
} = commandRegistryModule;

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

/** Reports whether a command should be intercepted rather than left to reach Electron's menu roles. */
export const shouldPreventDefault = (command: string) => !roleCommands.includes(command);
