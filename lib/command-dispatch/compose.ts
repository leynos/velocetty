/**
 * @file Composition root: builds the renderer's dispatcher and its adapters.
 *
 * Responsibilities:
 * - Construct the context-key service, the four driven adapters, the
 *   dispatcher, and the keybinding binder, in the one order their dependencies
 *   allow.
 * - Adapt the `DispatcherLogger` port to `console`, gating debug output behind
 *   the `?debug=1` query parameter so a shipped renderer is quiet.
 *
 * Invariants:
 * - Exactly one dispatcher exists per renderer; every source shares it.
 * - The keymap snapshot the catalogue reads is the same one the binder wrote,
 *   because both are closures over one holder.
 * - Nothing here reads a clock or starts a timer.
 *
 * Usage:
 * - `lib/index.tsx` calls `composeRendererDispatcher` inside `mountApp`.
 *
 * Related modules:
 * - `./dispatcher.ts`, `./ports.ts`, `./adapters/`, `./inbound/keybinding.ts`.
 */
import type {CommandId} from '@shared/types/commands';
import type {JsonObject} from '@shared/types/json';
import {createContextKeyService} from '../context-key-service';
import {get, getCommandHandler, getRegisteredKeys, validateArgs, validateResult} from '../command-registry';
import type {HyperDispatch} from '../../typings/hyper';
import {createContextKeyEnablement} from './adapters/context-key-enablement';
import {createReduxExecutionGate} from './adapters/redux-execution-gate';
import {createRegistryCatalogue} from './adapters/registry-catalogue';
import {createRendererExecutor, type RendererExecutionContext} from './adapters/renderer-executor';
import {createCommandDispatcher, type InterpretingDispatcher} from './dispatcher';
import {createKeybindingBinder, type KeybindingBinder, type MousetrapLike} from './inbound/keybinding';
import {createPluginCommandApi, type PluginCommandApi} from './inbound/plugin-api';
import type {DispatcherLogger} from './ports';

/** Everything the renderer must supply. */
export interface RendererDispatcherDependencies {
  readonly dispatch: HyperDispatch;
  /** Emits a host command on the existing fire-and-forget channel. */
  readonly emitHostCommand: (id: CommandId) => void;
  /** Creates or returns the Mousetrap instance for the document. */
  readonly getMousetrap: () => MousetrapLike;
  /** Overridable for tests; defaults to the console adapter. */
  readonly logger?: DispatcherLogger;
  /** Overridable for tests; defaults to reading `?debug=1` from the URL. */
  readonly isDebugEnabled?: () => boolean;
}

/** What the composition exposes to the application. */
export interface RendererDispatcherBundle {
  readonly dispatcher: InterpretingDispatcher<RendererExecutionContext>;
  readonly keybindings: KeybindingBinder;
  readonly invokeCommand: PluginCommandApi;
}

/** The keymap snapshot the binder writes and the catalogue reads. */
interface KeymapSnapshot {
  boundCommandIds: ReadonlySet<string>;
}

/** Reads `?debug=1` once, so a shipped renderer logs nothing at debug level. */
const isDebugRequested = (): boolean => globalThis.location.search.includes('debug=1');

/** Logs at warn level always, and at debug level only when asked. */
const createConsoleLogger = (isDebugEnabled: () => boolean): DispatcherLogger => ({
  debug: (message: string, details: JsonObject) => {
    if (isDebugEnabled()) {
      console.debug(message, details);
    }
  },
  warn: (message: string, details: JsonObject) => {
    console.warn(message, details);
  }
});

/**
 * Builds the renderer's dispatcher and everything it needs.
 *
 * The keymap snapshot is shared through one holder rather than passed around:
 * the catalogue reads it on every invocation, and the binder is the only writer.
 */
export const composeRendererDispatcher = (dependencies: RendererDispatcherDependencies): RendererDispatcherBundle => {
  const logger = dependencies.logger ?? createConsoleLogger(dependencies.isDebugEnabled ?? isDebugRequested);
  // Named so the mutable holder states its own contract rather than relying on
  // an anonymous object type.
  const snapshot: KeymapSnapshot = {boundCommandIds: new Set()};

  const catalogue = createRegistryCatalogue({
    registry: {get, validateArgs, validateResult},
    getBoundKeymapCommandIds: () => snapshot.boundCommandIds
  });

  const enablement = createContextKeyEnablement(createContextKeyService());
  const gate = createReduxExecutionGate(dependencies.dispatch);
  const executor = createRendererExecutor({
    getHandler: getCommandHandler,
    dispatch: dependencies.dispatch,
    emitHostCommand: dependencies.emitHostCommand
  });

  const dispatcher = createCommandDispatcher<RendererExecutionContext>({
    catalogue,
    enablement,
    gate,
    executor,
    logger
  });

  const keybindings = createKeybindingBinder({
    dispatcher,
    keymap: {getRegisteredKeys},
    getMousetrap: dependencies.getMousetrap,
    logger,
    onSnapshot: (boundCommandIds) => {
      snapshot.boundCommandIds = boundCommandIds;
    }
  });

  return {
    dispatcher,
    keybindings,
    invokeCommand: createPluginCommandApi(dispatcher)
  };
};
