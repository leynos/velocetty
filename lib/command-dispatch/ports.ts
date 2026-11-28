/**
 * @file Driven ports the command dispatcher needs, and nothing about how they
 * are satisfied.
 *
 * Responsibilities:
 * - Name the five services the interpreter calls: the command catalogue, the
 *   enablement evaluator, the execution gate, the command executor, and the
 *   logger.
 * - Keep React, Redux, Ajv, the transport, the context-key service, Hyper
 *   typings, and DOM event types out of the dispatcher core.
 *
 * Invariants:
 * - Every port is a plain interface over serializable values, so a test can
 *   satisfy it with an in-memory fake and the dispatcher cannot reach around it.
 * - `ExecutionGate.admit` reports only what it can observe. A swallowed action
 *   and a deferred one both report `pending`, because the Redux `effects`
 *   middleware makes them indistinguishable.
 *
 * Usage:
 * - `compose.ts` supplies the real adapters; tests supply fakes.
 *
 * Related modules:
 * - `./dispatcher.ts` consumes these types.
 * - `./adapters/` holds the real implementations.
 */
import type {CommandDefinition, CommandId, CommandInvocation, CommandValidationResult} from '@shared/types/commands';
import type {JsonObject, JsonValue} from '@shared/types/json';
import type {MachineEvent} from './policy/invocation-machine';

/**
 * A signal that never aborts, shared by every invocation whose caller passed
 * none.
 *
 * One instance rather than a fresh one per call: the interpreter compares
 * against it to know it must not attach an abort listener, so callers that
 * never cancel cannot accumulate listeners.
 */
export const NEVER_ABORTS_SIGNAL: AbortSignal = new AbortController().signal;

/** Resolves and validates command definitions. */
export interface CommandCatalogue {
  get(id: CommandId): CommandDefinition | undefined;
  validateArgs(id: CommandId, args: JsonValue): CommandValidationResult;
  validateResult(id: CommandId, value: JsonValue | undefined): CommandValidationResult;
}

/** What the enablement gate concluded about one `when` expression. */
export type EnablementVerdict =
  | {readonly kind: 'enabled'}
  | {readonly kind: 'disabled'}
  | {readonly kind: 'invalid'; readonly message: string};

/** Evaluates a `when` expression against the current context keys. */
export interface EnablementEvaluator {
  evaluate(expression: string): EnablementVerdict;
}

/** `pending`: the effect has not run yet; a swallow and a deferral look identical. */
export type GateOutcome = 'ran' | 'pending';

/**
 * The hop a command passes through before it executes.
 *
 * `run` is idempotent, never throws, and is a no-op after settlement, so a
 * middleware that re-dispatches a cloned action cannot execute twice.
 */
export interface ExecutionGate {
  admit(invocation: CommandInvocation, args: JsonValue, run: () => void): GateOutcome;
}

/** Where a command actually runs. */
export type ExecutionRoute = 'renderer' | 'host';

/** How execution began. */
export type ExecutionStart =
  | {readonly kind: 'hostEmitted'}
  | {readonly kind: 'rendererStarted'; readonly completion: Promise<JsonValue | undefined>};

/**
 * Routes and starts command execution.
 *
 * `TContext` carries whatever the adapter needs that the core must not name —
 * for the renderer, the keyboard event that triggered the invocation.
 */
export interface CommandExecutor<TContext> {
  /** Decides the route. The host route cannot carry arguments. */
  routeOf(id: CommandId): ExecutionRoute;
  /** Starts execution. The returned promise settles with the handler's value. */
  start(
    invocation: CommandInvocation,
    args: JsonValue,
    signal: AbortSignal,
    context: TContext | undefined
  ): ExecutionStart;
}

/** Structured logging. The dispatcher makes no `console` calls of its own. */
export interface DispatcherLogger {
  debug(message: string, details: JsonObject): void;
  warn(message: string, details: JsonObject): void;
}

/**
 * Records every event the interpreter feeds the machine.
 *
 * Only tests supply one. It exists so a property can fold the recorded trace
 * through the proved machine and check that the interpreter's resolved result
 * agrees with the machine's verdict — that is `INV-INTERPRETER-REFINES`.
 */
export interface MachineTracer {
  (event: MachineEvent): void;
}
