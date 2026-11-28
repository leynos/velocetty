/** @file Command registry and validation helpers for renderer command dispatch. */
import type {RendererCommandTransport} from '@shared/types/transport';
import type {CloseSearchAction} from './commands/search-close';
import {
  type LegacyCommandHandler,
  type RendererCommandHandler,
  toRendererCommandHandler
} from './command-registry-handlers';
import type {IpcCommands} from '@shared/types/common';
import {
  asCommandId,
  type CommandDefinition,
  type CommandId,
  type CommandOrderingComparator,
  type CommandRegistry,
  type CommandValidationResult
} from '@shared/types/commands';
import {
  closeSearchAction,
  createSearchCloseHandler,
  SEARCH_CLOSE_ARGS_SCHEMA,
  SEARCH_CLOSE_COMMAND_ID
} from './commands/search-close';
import {createCommandSchemaValidator} from './command-registry-validation';

interface RegisteredCommand extends CommandDefinition {
  handler?: RendererCommandHandler;
}

type CommandRegistryDependencies = {
  closeSearch: CloseSearchAction;
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

export const createCommandRegistryModule = (dependencies: CommandRegistryDependencies) => {
  const registry = new Map<CommandId, RegisteredCommand>();
  const runtimeManagedCommands = new Set<CommandId>();

  const getDefinition = (commandId: CommandId): CommandDefinition | undefined => {
    const command = registry.get(commandId);
    return command ? cloneCommandDefinition(command) : undefined;
  };

  // The validator is primed from the upsert path and forgets on removal, so a
  // schema is compiled once when its command is registered rather than on the
  // first keypress.
  const schemaValidator = createCommandSchemaValidator({getDefinition});

  const upsertCommand = (definition: CommandDefinition, handler?: RendererCommandHandler) => {
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

    schemaValidator.prime(definition.id);
  };

  const remove = (commandId: CommandId | string) => {
    const commandKey = asCommandId(commandId);
    schemaValidator.forget(commandKey);
    return registry.delete(commandKey);
  };

  const assignHandler = (commandId: CommandId, handler: RendererCommandHandler) => {
    const definition = registry.get(commandId) ?? createLegacyDefinition(commandId);
    upsertCommand(definition, handler);
  };

  const assignLegacyHandler = (commandId: CommandId, handler: LegacyCommandHandler) => {
    assignHandler(commandId, toRendererCommandHandler(handler));
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

  const validateArgs = (commandId: CommandId | string, args: unknown): CommandValidationResult =>
    schemaValidator.validateArgs(commandId, args);

  const validateResult = (commandId: CommandId | string, value: unknown): CommandValidationResult =>
    schemaValidator.validateResult(commandId, value);

  const get = (commandId: CommandId | string) => getDefinition(asCommandId(commandId));

  const list = () => {
    return [...registry.values()].map((definition) => cloneCommandDefinition(definition)).toSorted(compareByCommandId);
  };

  const has = (commandId: CommandId | string) => {
    return registry.has(asCommandId(commandId));
  };

  const getCommandHandler = (command: CommandId | string) => {
    return registry.get(asCommandId(command))?.handler;
  };

  // Optional, not merely `| undefined`: callers legitimately reach this with no
  // argument when a plugin set has not been assembled, and the guard below is
  // what makes that a no-op. Declaring the parameter required contradicted it.
  const registerCommandHandlers = (cmds?: Partial<Record<string, LegacyCommandHandler>>) => {
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

  upsertCommand({
    id: asCommandId(SEARCH_CLOSE_COMMAND_ID),
    kind: 'frontend',
    metadata: {
      title: 'Close Search'
    },
    argsSchema: cloneSchema(SEARCH_CLOSE_ARGS_SCHEMA)
  });
  assignHandler(asCommandId(SEARCH_CLOSE_COMMAND_ID), createSearchCloseHandler(dependencies));

  const commandRegistry: CommandRegistry<RendererCommandHandler> = {
    register: upsertCommand,
    update: upsertCommand,
    remove,
    get,
    list,
    has,
    validateArgs,
    validateResult
  };

  return {
    commandRegistry,
    get,
    getCommandHandler,
    getRegisteredKeys,
    has,
    list,
    register: upsertCommand,
    registerCommandHandlers,
    remove,
    update: upsertCommand,
    validateArgs,
    validateResult
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
export const {validateArgs, validateResult, register, update, remove, get, list, has} = commandRegistryModule;

/** Public `CommandRegistry<CommandHandler>` entry point with CRUD and validation APIs. */
export const commandRegistry: CommandRegistry<RendererCommandHandler> = commandRegistryModule.commandRegistry;

/** Async key resolution, handler management, and bulk registration. */
export const {getRegisteredKeys, registerCommandHandlers, getCommandHandler} = commandRegistryModule;

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
