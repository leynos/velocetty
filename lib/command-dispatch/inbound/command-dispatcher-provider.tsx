/**
 * @file React context that hands the renderer's dispatcher bundle to the tree.
 *
 * Responsibilities:
 * - Publish the one bundle the composition root built.
 * - Give UI components a hook that fixes the invocation source to `ui`, so a
 *   component cannot claim to be a keybinding or a plugin.
 *
 * Invariants:
 * - The hook never lets a caller choose `source`; the provider's whole point is
 *   that the source of a UI invocation is not the component's to assert.
 * - Rendering without a provider is not an error. A component that renders
 *   outside the application tree — a plugin's own subtree, a unit test — gets a
 *   failing invoker rather than a crash.
 *
 * Usage:
 * - `lib/index.tsx` wraps the tree in `CommandDispatcherProvider`.
 * - `const invoke = useCommandInvoker(); void invoke({id, args});`
 *
 * Related modules:
 * - `../compose.ts` builds the bundle this publishes.
 * - `../dispatcher.ts` defines `invoke`.
 */
import {createContext, useContext, useMemo, type PropsWithChildren} from 'react';

import type {CommandInvocation, CommandResult} from '@shared/types/commands';
import type {RendererDispatcherBundle} from '../compose';

/** A caller's invocation, minus the source the hook supplies. */
export type UiCommandRequest = Omit<CommandInvocation, 'source'>;

/** Invokes a command from UI code. Never rejects. */
export type CommandInvoker = (
  request: UiCommandRequest,
  options?: {readonly signal?: AbortSignal}
) => Promise<CommandResult>;

/** The bundle, or `undefined` outside the application tree. */
export const CommandDispatcherContext = createContext<RendererDispatcherBundle | undefined>(undefined);

/** Publishes one bundle to the subtree. */
export const CommandDispatcherProvider = ({
  bundle,
  children
}: PropsWithChildren<{readonly bundle: RendererDispatcherBundle}>) => (
  <CommandDispatcherContext.Provider value={bundle}>{children}</CommandDispatcherContext.Provider>
);

/** The bundle, for adapters that need the keybindings or the plugin facade. */
export const useDispatcherBundle = (): RendererDispatcherBundle | undefined => useContext(CommandDispatcherContext);

/**
 * Returns an invoker that always reports `source: 'ui'`.
 *
 * Outside a provider the invoker resolves `COMMAND_EXECUTION_FAILED` rather
 * than throwing: a plugin-rendered subtree calling a command should fail that
 * call, not take the renderer down.
 */
export const useCommandInvoker = (): CommandInvoker => {
  const bundle = useContext(CommandDispatcherContext);

  return useMemo<CommandInvoker>(() => {
    if (!bundle) {
      return async (request) => ({
        status: 'error',
        error: {
          code: 'COMMAND_EXECUTION_FAILED',
          commandId: request.id,
          message: `No command dispatcher is available for: ${request.id}`
        }
      });
    }

    const {dispatcher} = bundle;
    return (request, options) => dispatcher.invoke({...request, source: 'ui'}, options, {triggerEvent: undefined});
  }, [bundle]);
};
