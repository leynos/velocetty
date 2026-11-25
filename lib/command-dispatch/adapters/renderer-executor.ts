/**
 * @file Executor adapter for the renderer.
 *
 * Responsibilities:
 * - Decide the route: a command with a registered renderer handler runs here,
 *   and a command without one is emitted to the host exactly as before.
 * - Build the handler request from the invocation, the validated arguments, the
 *   caller's signal, the Redux dispatcher, and the triggering keyboard event.
 *
 * Invariants:
 * - Routing is by handler presence, never by `kind`. Plugins override built-in
 *   host commands with renderer handlers, and the golden-path demonstration
 *   command declares `kind: 'frontend'` while living in the main process.
 * - The host route is fire-and-forget: it cannot report a value, so it starts
 *   and finishes as `hostEmitted`.
 * - A handler that throws synchronously becomes a rejected completion, because
 *   the handler's failure must settle the invocation rather than escape into
 *   the Redux effect.
 *
 * Usage:
 * - `compose.ts` builds one; the interpreter calls it through `CommandExecutor`.
 *
 * Related modules:
 * - `../ports.ts` declares `CommandExecutor`.
 * - `../../command-registry-handlers.ts` owns the request and handler types.
 */
import type {CommandId, CommandInvocation} from '@shared/types/commands';
import type {JsonValue} from '@shared/types/json';
import type {HyperDispatch} from '../../../typings/hyper';
import type {RendererCommandHandler} from '../../command-registry-handlers';
import type {CommandExecutor, ExecutionRoute, ExecutionStart} from '../ports';

/** What the renderer executor needs beyond the invocation itself. */
export interface RendererExecutionContext {
  /** The keyboard event, for `keybinding` invocations only. */
  readonly triggerEvent: Event | undefined;
}

export interface RendererExecutorDependencies {
  /** Resolves a renderer handler, or `undefined` when the host owns the command. */
  readonly getHandler: (id: CommandId) => RendererCommandHandler | undefined;
  readonly dispatch: HyperDispatch;
  /** Emits a host command on the existing fire-and-forget channel. */
  readonly emitHostCommand: (id: CommandId) => void;
}

/** Builds the renderer executor. */
export const createRendererExecutor = (
  dependencies: RendererExecutorDependencies
): CommandExecutor<RendererExecutionContext> => ({
  routeOf: (id: CommandId): ExecutionRoute => (dependencies.getHandler(id) ? 'renderer' : 'host'),

  start: (
    invocation: CommandInvocation,
    args: JsonValue,
    signal: AbortSignal,
    context: RendererExecutionContext | undefined
  ): ExecutionStart => {
    const handler = dependencies.getHandler(invocation.id);
    if (!handler) {
      dependencies.emitHostCommand(invocation.id);
      return {kind: 'hostEmitted'};
    }

    // An async closure converts a synchronous throw into a rejection, so the
    // handler's failure settles the invocation instead of escaping into the
    // Redux effect that called it.
    const completion = (async () =>
      handler({
        invocation,
        args,
        signal,
        dispatch: dependencies.dispatch,
        triggerEvent: context?.triggerEvent
      }))();

    return {kind: 'rendererStarted', completion};
  }
});
