/**
 * @file Renderer-side command handler contract and legacy adapter.
 *
 * Responsibilities:
 * - Define the request a renderer handler receives: the invocation, its
 *   validated arguments, the caller's signal, the Redux dispatcher, and the
 *   keyboard event when there is one.
 * - Wrap the legacy `(event, dispatch)` handler shape that `PLUGINS.md`
 *   documents, so third-party Hyper plugins keep working unchanged.
 *
 * Invariants:
 * - A legacy wrapper ignores whatever the legacy handler returns; only a
 *   handler written against `RendererCommandRequest` can report a value.
 * - The trigger event is present only for keybinding invocations, which is what
 *   `PLUGINS.md` now states.
 *
 * Usage:
 * - The registry stores `RendererCommandHandler` values. Callers who have a
 *   legacy handler pass it to `registerCommandHandlers`, which applies
 *   `toRendererCommandHandler`.
 *
 * Related modules:
 * - `./command-registry.ts` stores and looks up these handlers.
 * - `./command-dispatch/dispatcher.ts` calls one through the executor port.
 * - `shared/src/types/commands.ts` owns the serializable half of the contract.
 */
import type {CommandInvocation} from '@shared/types/commands';
import type {JsonValue} from '@shared/types/json';
import type {HyperDispatch} from '../typings/hyper';

/** Everything a renderer command handler is given, and nothing more. */
export interface RendererCommandRequest {
  readonly invocation: CommandInvocation;
  /** Validated arguments, normalized to `null` when the caller passed none. */
  readonly args: JsonValue;
  readonly signal: AbortSignal;
  readonly dispatch: HyperDispatch;
  /** The keyboard event for `keybinding` invocations; otherwise `undefined`. */
  readonly triggerEvent: Event | undefined;
}

/**
 * A renderer command handler.
 *
 * Returning a promise is how a handler opts into cooperative cancellation: the
 * dispatcher settles the invocation at once when the signal aborts, and the
 * handler observes `request.signal` to stop early.
 */
export type RendererCommandHandler = (
  request: RendererCommandRequest
) => JsonValue | undefined | Promise<JsonValue | undefined>;

/** The legacy Hyper plugin handler shape documented in `PLUGINS.md`. */
export type LegacyCommandHandler = (event: unknown, dispatch: HyperDispatch) => void;

/**
 * The signal carried by invocations whose caller supplied none.
 *
 * One shared instance rather than a fresh one per call: the dispatcher can
 * compare against it to know it need not attach an abort listener, and callers
 * that never cancel cannot accumulate listeners.
 */
export const NEVER_ABORTS_SIGNAL: AbortSignal = new AbortController().signal;

/**
 * Adapts a legacy `(event, dispatch)` handler to the request shape.
 *
 * The legacy return value is discarded deliberately: plugins written for
 * Hyper return nothing, and silently treating an incidental return value as a
 * command result would change their meaning.
 */
export const toRendererCommandHandler =
  (legacy: LegacyCommandHandler): RendererCommandHandler =>
  (request) =>
    // A legacy handler has no result to report; the `void` operator makes that
    // explicit to the type system instead of leaving an inferred `void` that
    // the handler signature would reject.
    void legacy(request.triggerEvent, request.dispatch);
