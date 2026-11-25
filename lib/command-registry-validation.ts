/**
 * @file JSON Schema validation for command arguments and results.
 *
 * Responsibilities:
 * - Compile one Ajv validator per declared command schema, once, when the
 *   command is registered rather than on the first invocation.
 * - Report every validation failure as a structured, serializable issue list.
 * - Distinguish a payload that violates its schema from a schema that cannot
 *   be compiled at all, because the two need different operator responses.
 *
 * Invariants:
 * - A schema is compiled at most once per registration; `prime` replaces any
 *   cached verdict, so re-registering a changed schema never serves a stale
 *   validator.
 * - A schema that fails to compile is cached as a failure, so every later
 *   validation of that command reports `INVALID_COMMAND_SCHEMA` rather than
 *   throwing at an unpredictable moment.
 *
 * Usage:
 * - Construct one validator per registry with `createCommandSchemaValidator`,
 *   passing a definition lookup. The registry calls `prime` from its upsert
 *   path and `forget` from its remove path.
 *
 * Related modules:
 * - `./command-registry.ts` owns the definitions and drives this module.
 */
import Ajv, {type ErrorObject, type ValidateFunction} from 'ajv';
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
import {isJsonObject} from '@shared/types/json';

/** The outcome of compiling one command's schema, cached for its lifetime. */
type CompiledSchema =
  | {readonly kind: 'compiled'; readonly validate: ValidateFunction}
  | {readonly kind: 'invalidSchema'; readonly message: string};

export interface CommandSchemaValidator {
  /** Compiles the command's schema now, replacing any cached verdict. */
  prime(commandId: CommandId): void;
  /** Drops any cached verdict, so the next validation recompiles. */
  forget(commandId: CommandId): void;
  /** Validates arguments, reporting a missing command as `COMMAND_NOT_FOUND`. */
  validateArgs(commandId: CommandId | string, args: unknown): CommandValidationResult;
}

export interface CommandSchemaValidatorDependencies {
  /** Resolves the definition whose `argsSchema` should govern the payload. */
  getDefinition(commandId: CommandId): CommandDefinition | undefined;
}

/** Accepts an optional path string and normalizes it to a guaranteed string. */
const asIssuePath = (value: string | undefined): string => value ?? '';

const serializeAjvErrors = (errors: ErrorObject[] | null | undefined): CommandValidationIssue[] =>
  (errors ?? []).map((error) => ({
    instancePath: asIssuePath(error.dataPath),
    schemaPath: asIssuePath(error.schemaPath),
    keyword: error.keyword,
    message: error.message ?? 'Schema validation failed',
    params: isJsonObject(error.params) ? error.params : {}
  }));

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

const toArgsError = (commandId: CommandId, issues: CommandValidationIssue[]): CommandValidationError => ({
  code: 'INVALID_COMMAND_ARGS',
  commandId,
  target: 'args',
  message: `Invalid args for command: ${commandId}`,
  issues
});

/** Creates a schema validator that caches one compiled Ajv validator per command. */
export const createCommandSchemaValidator = (
  dependencies: CommandSchemaValidatorDependencies
): CommandSchemaValidator => {
  const ajv = new Ajv({allErrors: true});
  const compiledByCommandId = new Map<CommandId, CompiledSchema>();

  const compile = (commandId: CommandId, schema: CommandSchema): CompiledSchema => {
    try {
      return {kind: 'compiled', validate: ajv.compile(schema)};
    } catch (error) {
      // Cache the failure: an invalid schema must report the same error every
      // time it is validated, not only on the first attempt.
      return {kind: 'invalidSchema', message: describeSchemaFailure(error, commandId)};
    }
  };

  const compiledFor = (commandId: CommandId, schema: CommandSchema): CompiledSchema => {
    const cached = compiledByCommandId.get(commandId);
    if (cached) {
      return cached;
    }

    const fresh = compile(commandId, schema);
    compiledByCommandId.set(commandId, fresh);
    return fresh;
  };

  const prime = (commandId: CommandId): void => {
    compiledByCommandId.delete(commandId);
    const definition = dependencies.getDefinition(commandId);
    if (definition?.argsSchema) {
      compiledByCommandId.set(commandId, compile(commandId, definition.argsSchema));
    }
  };

  const forget = (commandId: CommandId): void => {
    compiledByCommandId.delete(commandId);
  };

  const validateArgs = (commandId: CommandId | string, args: unknown): CommandValidationResult => {
    const commandKey = asCommandId(commandId);
    const definition = dependencies.getDefinition(commandKey);
    if (!definition) {
      return {
        ok: false,
        error: {
          code: 'COMMAND_NOT_FOUND',
          commandId: commandKey,
          target: 'args',
          message: `Cannot validate args for unknown command: ${commandKey}`
        }
      };
    }

    if (!definition.argsSchema) {
      return {ok: true, value: args};
    }

    const compiled = compiledFor(commandKey, definition.argsSchema);
    if (compiled.kind === 'invalidSchema') {
      return {ok: false, error: toSchemaError(commandKey, 'args', compiled.message)};
    }

    if (compiled.validate(args)) {
      return {ok: true, value: args};
    }

    return {ok: false, error: toArgsError(commandKey, serializeAjvErrors(compiled.validate.errors))};
  };

  return {prime, forget, validateArgs};
};
