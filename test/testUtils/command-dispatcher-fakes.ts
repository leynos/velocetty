/**
 * @file In-memory fakes for the command dispatcher's driven ports.
 *
 * Responsibilities:
 * - Supply a catalogue, enablement evaluator, execution gate, executor, and
 *   logger that a test can observe without touching React, Redux, or Ajv.
 * - Record every action the interpreter asked for, so a test can assert on the
 *   trace rather than only on the final result.
 *
 * Invariants:
 * - The gate records whether the effect ran synchronously and never invents an
 *   outcome the real adapter could not report.
 * - No fake uses a timer, so tests stay deterministic under `--concurrent`.
 *
 * Usage:
 * - `createDispatcherFakes({...})`, then pass `fakes.ports` to
 *   `createCommandDispatcher`.
 *
 * Related modules:
 * - `../../lib/command-dispatch/ports.ts`
 * - `../../lib/command-dispatch/dispatcher.ts`
 */
import {
  asCommandId,
  type CommandDefinition,
  type CommandId,
  type CommandInvocation,
  type CommandValidationResult
} from '@shared/types/commands';
import type {JsonObject, JsonValue} from '@shared/types/json';
import type {
  CommandCatalogue,
  CommandExecutor,
  DispatcherLogger,
  EnablementVerdict,
  ExecutionGate,
  ExecutionRoute,
  ExecutionStart,
  GateOutcome
} from '../../lib/command-dispatch/ports';
import type {CommandDispatcherPorts} from '../../lib/command-dispatch/dispatcher';

/** Reads a schema's declared `const`, if it has one. */
const declaredConst = (schema: JsonObject | undefined): JsonValue | undefined => {
  if (!schema || !('const' in schema)) {
    return undefined;
  }
  return schema['const'];
};

/** A recorded logger line. */
export interface LogLine {
  readonly level: 'debug' | 'warn';
  readonly message: string;
  readonly details: JsonObject;
}

export interface FakeCommand {
  readonly definition: CommandDefinition;
  handlerValue?: JsonValue;
  /** When set, the renderer "handler" rejects with this reason. */
  rejection?: unknown;
  /** When set, the renderer handler never settles on its own. */
  pending?: boolean;
}

export interface DispatcherFakeOptions {
  readonly commands?: Readonly<Record<string, FakeCommand>>;
  /** Identifiers the keymap binds but the catalogue does not define. */
  readonly boundKeymapCommandIds?: readonly string[];
  /** Route overrides; a command without a handler routes to the host. */
  readonly hostCommandIds?: readonly string[];
  /** Defer the execution gate instead of running it synchronously. */
  readonly deferGate?: boolean;
  /** Swallow the execution gate entirely, leaving the invocation pending. */
  readonly swallowGate?: boolean;
  readonly enablement?: (expression: string) => EnablementVerdict;
}

export interface DispatcherFakes<TContext> {
  readonly ports: CommandDispatcherPorts<TContext>;
  readonly logs: LogLine[];
  readonly gateAdmissions: {invocation: CommandInvocation; args: JsonValue}[];
  readonly handlerCalls: {
    invocation: CommandInvocation;
    args: JsonValue;
    signal: AbortSignal;
    context: TContext | undefined;
  }[];
  readonly hostEmissions: CommandId[];
  /** Resolves once the deferred gate effect runs. */
  runDeferredGate: () => void;
}

const NOT_FOUND = (commandId: CommandId): CommandValidationResult => ({
  ok: false,
  error: {code: 'COMMAND_NOT_FOUND', commandId, message: `Unknown command: ${commandId}`}
});

/**
 * Builds the five fakes over a small command table.
 *
 * A command with `handlerValue`, `rejection`, or `pending` set routes to the
 * renderer; everything else routes to the host.
 */
export const createDispatcherFakes = <TContext = undefined>(
  options: DispatcherFakeOptions = {}
): DispatcherFakes<TContext> => {
  // A Map, not a record: lookups must be honestly `| undefined`, and a record
  // indexed by a branded string does not say so.
  const commands = new Map<string, FakeCommand>(Object.entries(options.commands ?? {}));
  const hostCommandIds = new Set(options.hostCommandIds);
  const boundKeymapCommandIds = new Set(options.boundKeymapCommandIds ?? new Set<string>());
  const logs: LogLine[] = [];
  const gateAdmissions: {invocation: CommandInvocation; args: JsonValue}[] = [];
  const handlerCalls: DispatcherFakes<TContext>['handlerCalls'] = [];
  const hostEmissions: CommandId[] = [];
  let deferredRun: (() => void) | undefined;

  const resolveDefinition = (id: CommandId): CommandDefinition | undefined => {
    const entry = commands.get(id);
    if (entry) {
      return entry.definition;
    }
    if (boundKeymapCommandIds.has(id)) {
      return {id, kind: 'backend', metadata: {title: id}};
    }
    return undefined;
  };

  const validate = (id: CommandId, payload: unknown, target: 'args' | 'result'): CommandValidationResult => {
    const entry = commands.get(id);
    if (!entry) {
      return boundKeymapCommandIds.has(id) ? {ok: true, value: payload} : NOT_FOUND(id);
    }

    const schema = target === 'args' ? entry.definition.argsSchema : entry.definition.resultSchema;
    if (!schema) {
      return {ok: true, value: payload};
    }
    // The fakes accept any payload when a schema is declared; schema semantics
    // are the registry's job and are tested there. What matters here is whether
    // the interpreter consults the verdict at all.
    const allowed = declaredConst(schema);
    if (allowed !== undefined && payload !== allowed) {
      return {
        ok: false,
        error: {
          code: target === 'args' ? 'INVALID_COMMAND_ARGS' : 'INVALID_COMMAND_RESULT',
          commandId: id,
          target,
          message: `Payload does not match the ${target} schema for ${id}`
        }
      };
    }
    return {ok: true, value: payload};
  };

  const catalogue: CommandCatalogue = {
    get: (id) => resolveDefinition(id),
    validateArgs: (id, args) => validate(id, args, 'args'),
    validateResult: (id, value) => validate(id, value, 'result')
  };

  const gate: ExecutionGate = {
    admit: (invocation, args, run): GateOutcome => {
      gateAdmissions.push({invocation, args});
      if (options.swallowGate) {
        return 'pending';
      }
      if (options.deferGate) {
        deferredRun = run;
        return 'pending';
      }
      run();
      return 'ran';
    }
  };

  const executor: CommandExecutor<TContext> = {
    routeOf: (id): ExecutionRoute => (hostCommandIds.has(id) ? 'host' : 'renderer'),
    start: (invocation, args, signal, context): ExecutionStart => {
      if (hostCommandIds.has(invocation.id)) {
        hostEmissions.push(invocation.id);
        return {kind: 'hostEmitted'};
      }

      const entry = commands.get(invocation.id);
      handlerCalls.push({invocation, args, signal, context});

      if (entry?.pending === true) {
        return {kind: 'rendererStarted', completion: new Promise<JsonValue | undefined>(() => {})};
      }
      if (entry && entry.rejection !== undefined) {
        return {kind: 'rendererStarted', completion: Promise.reject(entry.rejection)};
      }
      return {kind: 'rendererStarted', completion: Promise.resolve(entry?.handlerValue)};
    }
  };

  const logger: DispatcherLogger = {
    debug: (message, details) => {
      logs.push({level: 'debug', message, details});
    },
    warn: (message, details) => {
      logs.push({level: 'warn', message, details});
    }
  };

  return {
    ports: {
      catalogue,
      enablement: {evaluate: options.enablement ?? (() => ({kind: 'enabled'}))},
      gate,
      executor,
      logger
    },
    logs,
    gateAdmissions,
    handlerCalls,
    hostEmissions,
    runDeferredGate: () => {
      const run = deferredRun;
      deferredRun = undefined;
      run?.();
    }
  };
};

/** Builds a definition with the given schemas. */
export const fakeDefinition = (id: string, extras: Partial<CommandDefinition> = {}): CommandDefinition => ({
  id: asCommandId(id),
  kind: 'frontend',
  metadata: {title: id},
  ...extras
});
