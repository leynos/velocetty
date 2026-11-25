/**
 * @file Execution gate adapter over Redux.
 *
 * Responsibilities:
 * - Dispatch `UI_COMMAND_EXEC` carrying the source and a frozen copy of the
 *   validated arguments, with an `effect` that runs the handler.
 * - Report `pending` when `dispatch` returns without the effect having run, so
 *   the invocation settles only when the effect runs or the caller's signal
 *   aborts.
 *
 * Invariants:
 * - The `run` passed to the effect is idempotent. A plugin middleware that
 *   re-dispatches a cloned action therefore cannot execute the handler twice.
 * - The arguments the effect carries are a `structuredClone`, deeply frozen, so
 *   a middleware that observes the action cannot mutate what the handler sees.
 * - A swallow and a deferral are reported identically. The Redux `effects`
 *   middleware runs the effect after `next(action)` returns, so the two are
 *   indistinguishable by construction; claiming otherwise would be a lie.
 *
 * Usage:
 * - `compose.ts` builds one over the renderer store's `dispatch`.
 *
 * Related modules:
 * - `../ports.ts` declares `ExecutionGate`.
 * - `../../utils/effects.ts` runs the `effect` callback.
 */
import {UI_COMMAND_EXEC} from '@shared/constants/ui';
import type {CommandInvocation} from '@shared/types/commands';
import type {JsonObject, JsonValue} from '@shared/types/json';
import type {ExecutionGate, GateOutcome} from '../ports';

/** The action this gate dispatches. */
export interface CommandExecutionAction {
  readonly type: typeof UI_COMMAND_EXEC;
  readonly command: CommandInvocation['id'];
  readonly source: CommandInvocation['source'];
  readonly args: JsonValue;
  readonly effect: () => void;
}

/**
 * The slice of the store this adapter needs.
 *
 * Redux's `dispatch` returns the action, and no caller of this gate reads it,
 * so the adapter states that rather than widening to `unknown`.
 */
export interface ExecutionGateDispatcher {
  (action: CommandExecutionAction): CommandExecutionAction;
}

const isFreezable = (value: JsonValue): value is JsonObject | JsonValue[] =>
  value !== null && typeof value === 'object' && !Object.isFrozen(value);

/** Freezes a JSON value and everything nested inside it. */
const deepFreeze = (value: JsonValue): JsonValue => {
  if (!isFreezable(value)) {
    return value;
  }
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
};

/** Builds the execution gate over a Redux `dispatch`. */
export const createReduxExecutionGate = (dispatch: ExecutionGateDispatcher): ExecutionGate => ({
  admit: (invocation: CommandInvocation, args: JsonValue, run: () => void): GateOutcome => {
    // Held in an object rather than a `let`: the effect mutates it, and TypeScript
    // would otherwise narrow a plain local to `false` and call the check
    // unreachable.
    const state = {hasRun: false};
    const guardedRun = (): void => {
      if (state.hasRun) {
        return;
      }
      state.hasRun = true;
      run();
    };

    dispatch({
      type: UI_COMMAND_EXEC,
      command: invocation.id,
      source: invocation.source,
      args: deepFreeze(structuredClone(args)),
      effect: guardedRun
    });

    return state.hasRun ? 'ran' : 'pending';
  }
});
