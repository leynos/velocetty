/**
 * @file The command dispatcher: a thin interpreter over the proved invocation
 * machine.
 *
 * Responsibilities:
 * - Hold exactly one `MachineState` per invocation.
 * - Ask the machine what to do next and do only that: evaluate the named
 *   admission gate, open the execution gate, run the handler, settle.
 * - Feed each outcome back as the next `MachineEvent`.
 * - Resolve the invocation's promise in exactly one place.
 *
 * Invariants:
 * - `step` is called in exactly one function and the promise is resolved in
 *   exactly one function, so the interpreter cannot take a shortcut around the
 *   proof. `interpreter-structure.test.ts` asserts both call-site counts,
 *   because a proof of a machine the interpreter bypasses would be worthless.
 * - Admission is synchronous. When nothing defers the execution gate, the
 *   handler runs before `invoke` returns its promise, which is what lets legacy
 *   handlers call `event.preventDefault()` in time.
 * - An abort listener is attached only when the caller supplied a signal, and
 *   it is removed on settlement.
 * - `invoke` never rejects, and a handler rejection never reaches the runtime
 *   unhandled; a late rejection reaches the logger port instead.
 *
 * Usage:
 * - `compose.ts` builds one dispatcher for the renderer; tests build one over
 *   in-memory fakes.
 *
 * Related modules:
 * - `./policy/invocation-machine.ts` is the proved core.
 * - `./ports.ts` defines what the interpreter may call.
 * - `./adapters/` satisfies those ports with real infrastructure.
 */
import type {
  CommandDispatchOptions,
  CommandInvocation,
  CommandInvocationError,
  CommandResult
} from '@shared/types/commands';
import {isObject} from '@shared/types/guards';
import type {JsonValue} from '@shared/types/json';
import {
  initialState,
  type MachineAction,
  type MachineEvent,
  type MachineState,
  outcomeOf,
  step
} from './policy/invocation-machine';
import {
  NEVER_ABORTS_SIGNAL,
  type CommandCatalogue,
  type CommandExecutor,
  type DispatcherLogger,
  type EnablementEvaluator,
  type ExecutionGate,
  type MachineTracer
} from './ports';

export interface CommandDispatcherPorts<TContext> {
  readonly catalogue: CommandCatalogue;
  readonly enablement: EnablementEvaluator;
  readonly gate: ExecutionGate;
  readonly executor: CommandExecutor<TContext>;
  readonly logger: DispatcherLogger;
  /** Optional recorder for the machine's event trace; tests only. */
  readonly trace?: MachineTracer;
}

export interface AdmissionCheck {
  readonly admitted: boolean;
  readonly error?: CommandInvocationError;
}

export interface InterpretingDispatcher<TContext> {
  /** Runs one command. Never rejects. */
  invoke(invocation: CommandInvocation, options?: CommandDispatchOptions, context?: TContext): Promise<CommandResult>;
  /**
   * Pure query: runs only the machine's admission phase, synchronously, and
   * reports whether `invoke` would be admitted. Nothing is dispatched, emitted,
   * or run.
   */
  check(invocation: CommandInvocation): AdmissionCheck;
}

type GateVerdict = {readonly ok: true} | {readonly ok: false; readonly error: CommandInvocationError};

/** Sources for which `when` enablement is a real affordance gate. */
const AFFORDANCE_SOURCES: ReadonlySet<string> = new Set(['keybinding', 'palette', 'menu', 'ui']);

const GATE_RESOLVE = 0;
const GATE_ROUTE_ARGS = 1;
const GATE_VALIDATE_ARGS = 2;

const invalidArgs = (commandId: CommandInvocation['id'], message: string): CommandInvocationError => ({
  code: 'INVALID_COMMAND_ARGS',
  commandId,
  message
});

/**
 * Normalizes absent arguments to `null`.
 *
 * `undefined` is not a JSON value and does not survive the wire. `null` makes
 * optionality explicit in the schema and is what lets Escape's no-argument
 * binding validate against `type: ['object', 'null']`.
 */
const normalizeArgs = (args: JsonValue | undefined): JsonValue => args ?? null;

const deepFreeze = <TValue>(value: TValue): TValue => {
  if (isObject(value) && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
};

/** The one place the interpreter consults the proved machine. */
const transition = (state: MachineState, event: MachineEvent) => step(state, event);

/** The gate the machine is waiting on, or `null` once admission is over. */
const gateToEvaluate = (state: MachineState): number | null => (state.phase === 'admitting' ? state.gate : null);

const evaluateGate = <TContext>(
  ports: CommandDispatcherPorts<TContext>,
  gate: number,
  invocation: CommandInvocation,
  args: JsonValue
): GateVerdict => {
  const {id: commandId, source} = invocation;

  if (gate === GATE_RESOLVE) {
    if (!ports.catalogue.get(commandId)) {
      return {
        ok: false,
        error: {code: 'COMMAND_NOT_FOUND', commandId, message: `Unknown command: ${commandId}`}
      };
    }
    return {ok: true};
  }

  if (gate === GATE_ROUTE_ARGS) {
    // The host channel is fire-and-forget and cannot carry arguments, so a host
    // command refuses anything but the normalized "no arguments" value.
    if (ports.executor.routeOf(commandId) === 'host' && args !== null) {
      return {ok: false, error: invalidArgs(commandId, `Host command cannot carry arguments: ${commandId}`)};
    }
    return {ok: true};
  }

  if (gate === GATE_VALIDATE_ARGS) {
    const validation = ports.catalogue.validateArgs(commandId, args);
    if (validation.ok) {
      return {ok: true};
    }
    const {error} = validation;
    const failure: CommandInvocationError = {code: error.code, commandId, message: error.message};
    if (error.issues) {
      return {ok: false, error: {...failure, issues: error.issues}};
    }
    return {ok: false, error: failure};
  }

  // Enablement. Only the affordance sources honour `defaultWhen`; a plugin or
  // remote caller has already chosen to run the command.
  if (!AFFORDANCE_SOURCES.has(source)) {
    return {ok: true};
  }

  const expression = ports.catalogue.get(commandId)?.defaultWhen;
  if (!expression) {
    return {ok: true};
  }

  const verdict = ports.enablement.evaluate(expression);
  if (verdict.kind === 'enabled') {
    return {ok: true};
  }
  if (verdict.kind === 'disabled') {
    return {
      ok: false,
      error: {code: 'COMMAND_DISABLED', commandId, message: `Command is disabled: ${commandId}`}
    };
  }
  return {
    ok: false,
    error: {code: 'INVALID_WHEN_EXPRESSION', commandId, message: `Invalid when expression: ${verdict.message}`}
  };
};

const toCommandResult = (
  failed: CommandInvocationError,
  value: JsonValue | undefined,
  gateError: CommandInvocationError | undefined,
  resultError: CommandInvocationError | undefined,
  outcome: string
): CommandResult => {
  if (outcome === 'ok') {
    return value === undefined ? {status: 'ok'} : {status: 'ok', value};
  }
  if (outcome === 'cancelledBefore') {
    return {status: 'cancelled', stage: 'before-execution'};
  }
  if (outcome === 'cancelledDuring') {
    return {status: 'cancelled', stage: 'during-execution'};
  }
  if (outcome === 'rejected') {
    return {status: 'error', error: gateError ?? failed};
  }
  if (outcome === 'failedResult') {
    return {status: 'error', error: resultError ?? failed};
  }
  return {status: 'error', error: failed};
};

/** Builds the interpreter over the supplied ports. */
export const createCommandDispatcher = <TContext>(
  ports: CommandDispatcherPorts<TContext>
): InterpretingDispatcher<TContext> => {
  /** Runs the admission gates only. Shared by `check` and the interpreter. */
  const admit = (invocation: CommandInvocation, args: JsonValue) => {
    let state = initialState(false).state;
    let failure: CommandInvocationError | undefined;

    for (;;) {
      const gate = gateToEvaluate(state);
      if (gate === null) {
        return failure ? {state, error: failure} : {state};
      }

      const verdict = evaluateGate(ports, gate, invocation, args);
      if (!verdict.ok) {
        failure = verdict.error;
      }
      state = transition(state, verdict.ok ? {kind: 'gatePassed'} : {kind: 'gateFailed'}).state;
      if (failure) {
        return {state, error: failure};
      }
    }
  };

  const check = (invocation: CommandInvocation): AdmissionCheck => {
    const {error} = admit(invocation, normalizeArgs(invocation.args));
    return error ? {admitted: false, error} : {admitted: true};
  };

  const invoke = (
    invocation: CommandInvocation,
    options: CommandDispatchOptions = {},
    context?: TContext
  ): Promise<CommandResult> => {
    // A private snapshot, taken once: a deferred execution gate leaves the
    // caller holding the same object, and mutating it after admission would
    // otherwise hand the handler arguments the schema never approved.
    const args = deepFreeze(structuredClone(normalizeArgs(invocation.args)));
    const signal = options.signal;
    const commandId = invocation.id;

    let state = initialState(signal?.aborted === true).state;
    let gateError: CommandInvocationError | undefined;
    let resultError: CommandInvocationError | undefined;
    let handlerValue: JsonValue | undefined;
    let hasSettled = false;
    // Named `resolve` so the structural guard in
    // `interpreter-structure.test.ts` can count resolution call sites. The
    // placeholder is a real guard, not a no-op: reaching it would mean the
    // interpreter settled before the promise existed.
    let resolve: (result: CommandResult) => void = () => {
      ports.logger.warn('command settled before its promise was constructed', {commandId});
    };

    const result = new Promise<CommandResult>((resolvePromise) => {
      resolve = resolvePromise;
    });

    const failure = (code: CommandInvocationError['code']): CommandInvocationError => ({
      code,
      commandId,
      message: `Command failed: ${commandId}`
    });

    /** The single settlement point. Everything that ends an invocation ends here. */
    const performSettle = (): void => {
      if (hasSettled) {
        return;
      }
      hasSettled = true;
      signal?.removeEventListener('abort', onAbort);
      const reported = outcomeOf(state);
      resolve(toCommandResult(failure('COMMAND_EXECUTION_FAILED'), handlerValue, gateError, resultError, reported));
    };

    const performRunHandler = (): void => {
      const started = ports.executor.start(invocation, args, signal ?? NEVER_ABORTS_SIGNAL, context);
      if (started.kind === 'hostEmitted') {
        advance({kind: 'hostEmitted'});
        return;
      }

      started.completion.then(
        (value) => {
          handlerValue = value;
          const validation = ports.catalogue.validateResult(commandId, value);
          if (!validation.ok) {
            const {error} = validation;
            const failure: CommandInvocationError = {code: error.code, commandId, message: error.message};
            resultError = error.issues ? {...failure, issues: error.issues} : failure;
          }
          advance({kind: 'handlerFulfilled', resultValid: validation.ok});
        },
        (error: unknown) => {
          const isAbortReason = signal?.aborted === true && error === signal.reason;
          if (hasSettled) {
            // Consume a late rejection rather than letting it reach the runtime
            // unhandled; the handler's own side effects are its responsibility.
            ports.logger.debug('command handler rejected after settlement', {
              commandId,
              reason: error instanceof Error ? error.message : String(error)
            });
          }
          advance({kind: 'handlerRejected', isAbortReason});
        }
      );
    };

    /**
     * Runs one action. An adapter throwing is an infrastructure failure, not a
     * caller error: it settles the invocation as a structured failure instead
     * of rejecting a promise the contract says never rejects.
     */
    const perform = (action: MachineAction): void => {
      try {
        performAction(action);
      } catch (error) {
        ports.logger.warn('command dispatcher adapter threw', {
          commandId,
          reason: error instanceof Error ? error.message : String(error)
        });
        gateError = failure('COMMAND_EXECUTION_FAILED');
        advance({kind: 'gateFailed'});
      }
    };

    const performAction = (action: MachineAction): void => {
      switch (action.kind) {
        case 'evaluateGate': {
          const verdict = evaluateGate(ports, action.gate, invocation, args);
          if (!verdict.ok) {
            gateError = verdict.error;
          }
          advance(verdict.ok ? {kind: 'gatePassed'} : {kind: 'gateFailed'});
          return;
        }
        case 'openGate': {
          if (ports.gate.admit(invocation, args, onGateRun) === 'pending') {
            advance({kind: 'gatePending'});
          }
          return;
        }
        case 'runHandler': {
          performRunHandler();
          return;
        }
        case 'settle': {
          performSettle();
          return;
        }
        default: {
          return;
        }
      }
    };

    const advance = (event: MachineEvent): void => {
      ports.trace?.(event);
      const next = transition(state, event);
      state = next.state;
      perform(next.action);
    };

    /**
     * The execution gate's effect. Idempotent: a middleware that re-dispatches
     * a cloned action must not execute the handler twice, and the machine
     * absorbs a second `gateRan` once execution has begun.
     */
    const onGateRun = (): void => {
      advance({kind: 'gateRan'});
    };

    function onAbort(): void {
      advance({kind: 'aborted'});
    }

    if (signal && signal !== NEVER_ABORTS_SIGNAL && !signal.aborted) {
      signal.addEventListener('abort', onAbort, {once: true});
    }

    perform(state.phase === 'settled' ? {kind: 'settle'} : {kind: 'evaluateGate', gate: 0});
    return result;
  };

  return {invoke, check};
};
