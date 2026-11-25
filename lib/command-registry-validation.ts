/**
 * @file JSON Schema validation for command arguments and results.
 *
 * Responsibilities:
 * - Check one declared command schema, once, when the command is registered
 *   rather than on the first invocation.
 * - Report every validation failure as a structured, serializable issue list.
 * - Distinguish a payload that violates its schema from a schema that cannot
 *   be compiled at all, because the two need different operator responses.
 *
 * Invariants:
 * - A schema is checked at most once per registration; `prime` replaces any
 *   cached verdict, so re-registering a changed schema never serves a stale
 *   verdict.
 * - A schema that fails its own check is cached as a failure, so every later
 *   validation of that command reports `INVALID_COMMAND_SCHEMA` rather than
 *   throwing at an unpredictable moment.
 *
 * Validation is interpreted, not generated: `./command-schema-validator.ts`
 * explains why the renderer cannot use Ajv's code generation.
 *
 * Usage:
 * - Construct one validator per registry with `createCommandSchemaValidator`,
 *   passing a definition lookup. The registry calls `prime` from its upsert
 *   path and `forget` from its remove path.
 *
 * Related modules:
 * - `./command-registry.ts` owns the definitions and drives this module.
 */
import {checkSchema, validateAgainstSchema} from './command-schema-validator';
import {
  asCommandId,
  type CommandDefinition,
  type CommandId,
  type CommandSchema,
  type CommandValidationError,
  type CommandValidationIssue,
  type CommandValidationResult,
  type CommandValidationTarget
} from '@shared/types/commands';

/** The outcome of checking one command's schema, cached for its lifetime. */
type CompiledSchema = {readonly kind: 'usable'} | {readonly kind: 'invalidSchema'; readonly message: string};

export interface CommandSchemaValidator {
  /** Compiles the command's schema now, replacing any cached verdict. */
  prime(commandId: CommandId): void;
  /** Drops any cached verdict, so the next validation recompiles. */
  forget(commandId: CommandId): void;
  /** Validates arguments, reporting a missing command as `COMMAND_NOT_FOUND`. */
  validateArgs(commandId: CommandId | string, args: unknown): CommandValidationResult;
  /** Validates a handler result against `resultSchema`, when one is declared. */
  validateResult(commandId: CommandId | string, value: unknown): CommandValidationResult;
}

export interface CommandSchemaValidatorDependencies {
  /** Resolves the definition whose `argsSchema` should govern the payload. */
  getDefinition(commandId: CommandId): CommandDefinition | undefined;
}

const describeSchemaFailure = (cause: unknown, commandId: CommandId): string =>
  cause instanceof Error ? cause.message : `Invalid schema for command: ${commandId}`;

const toSchemaError = (
  commandId: CommandId,
  target: CommandValidationTarget,
  message: string
): CommandValidationError => ({
  code: 'INVALID_COMMAND_SCHEMA',
  commandId,
  target,
  message
});

/** Per-target wording, so one validation path serves both schemas. */
interface TargetNouns {
  readonly schemaProperty: 'argsSchema' | 'resultSchema';
  readonly errorCode: 'INVALID_COMMAND_ARGS' | 'INVALID_COMMAND_RESULT';
  readonly payloadName: string;
}

const TARGET_NOUNS: Record<CommandValidationTarget, TargetNouns> = {
  args: {schemaProperty: 'argsSchema', errorCode: 'INVALID_COMMAND_ARGS', payloadName: 'args'},
  result: {schemaProperty: 'resultSchema', errorCode: 'INVALID_COMMAND_RESULT', payloadName: 'result'}
};

const toPayloadError = (
  commandId: CommandId,
  target: CommandValidationTarget,
  issues: CommandValidationIssue[]
): CommandValidationError => ({
  code: TARGET_NOUNS[target].errorCode,
  commandId,
  target,
  message: `Invalid ${TARGET_NOUNS[target].payloadName} for command: ${commandId}`,
  issues
});

/** One cache key per (target, command) pair; the two schemas are distinct. */
const cacheKey = (commandId: CommandId, target: CommandValidationTarget): string => `${target}\u0000${commandId}`;

/**
 * Checks a schema once, then caches the verdict: a schema defect must report
 * the same error every time it is validated, not only on the first attempt.
 */
const compile = (schema: CommandSchema): CompiledSchema => {
  const check = checkSchema(schema);
  return check.ok ? {kind: 'usable'} : {kind: 'invalidSchema', message: check.message};
};

/** Creates a schema validator that caches one verdict per command and target. */
export const createCommandSchemaValidator = (
  dependencies: CommandSchemaValidatorDependencies
): CommandSchemaValidator => {
  // Keyed by target as well as command: a command may declare both schemas,
  // and they are different schemas.
  const compiledByKey = new Map<string, CompiledSchema>();

  const compiledFor = (
    commandId: CommandId,
    target: CommandValidationTarget,
    schema: CommandSchema
  ): CompiledSchema => {
    const key = cacheKey(commandId, target);
    const cached = compiledByKey.get(key);
    if (cached) {
      return cached;
    }

    const fresh = compile(schema);
    compiledByKey.set(key, fresh);
    return fresh;
  };

  const prime = (commandId: CommandId): void => {
    compiledByKey.delete(cacheKey(commandId, 'args'));
    compiledByKey.delete(cacheKey(commandId, 'result'));
    const definition = dependencies.getDefinition(commandId);
    if (definition?.argsSchema) {
      compiledByKey.set(cacheKey(commandId, 'args'), compile(definition.argsSchema));
    }
    if (definition?.resultSchema) {
      compiledByKey.set(cacheKey(commandId, 'result'), compile(definition.resultSchema));
    }
  };

  const forget = (commandId: CommandId): void => {
    compiledByKey.delete(cacheKey(commandId, 'args'));
    compiledByKey.delete(cacheKey(commandId, 'result'));
  };

  const validateTarget = (
    commandId: CommandId | string,
    target: CommandValidationTarget,
    payload: unknown
  ): CommandValidationResult => {
    const commandKey = asCommandId(commandId);
    const definition = dependencies.getDefinition(commandKey);
    if (!definition) {
      return {
        ok: false,
        error: {
          code: 'COMMAND_NOT_FOUND',
          commandId: commandKey,
          target,
          message: `Cannot validate ${TARGET_NOUNS[target].payloadName} for unknown command: ${commandKey}`
        }
      };
    }

    const schema = definition[TARGET_NOUNS[target].schemaProperty];
    if (!schema) {
      return {ok: true, value: payload};
    }

    const compiled = compiledFor(commandKey, target, schema);
    if (compiled.kind === 'invalidSchema') {
      return {ok: false, error: toSchemaError(commandKey, target, compiled.message)};
    }

    const issues = validateAgainstSchema(schema, payload);
    if (issues.length === 0) {
      return {ok: true, value: payload};
    }

    return {ok: false, error: toPayloadError(commandKey, target, issues)};
  };

  return {
    prime,
    forget,
    validateArgs: (commandId, args) => validateTarget(commandId, 'args', args),
    validateResult: (commandId, value) => validateTarget(commandId, 'result', value)
  };
};
