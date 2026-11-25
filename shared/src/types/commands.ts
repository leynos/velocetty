/** @file Shared command contracts for metadata, schemas, and validation outcomes. */
import type {JsonObject, JsonValue} from './json';

/** Stable identifier used across keymaps, menus, dispatchers, and handlers. */
declare const commandIdBrand: unique symbol;
export type CommandId = string & {[commandIdBrand]: 'CommandId'};
// SAFETY: Command IDs retain their string representation; the brand documents the shared command boundary.
export const asCommandId = (value: string | CommandId): CommandId => value as CommandId;
/** Execution location for a command handler. */
export type CommandKind = 'frontend' | 'backend';

declare const commandSchemaPayload: unique symbol;

/** JSON Schema payload used to validate command arguments and results. */
export type CommandSchema<TPayload = unknown> = JsonObject & {[commandSchemaPayload]?: TPayload};

/** UI-facing metadata that makes commands discoverable and explainable. */
export interface CommandMetadata {
  title: string;
  category?: string;
  description?: string;
  keywords?: string[];
  icon?: string;
}

/** Command contract shared between frontend and backend registries. */
export interface CommandDefinition<TArgs = unknown, TResult = unknown> {
  id: CommandId;
  metadata: CommandMetadata;
  kind: CommandKind;
  defaultWhen?: string;
  argsSchema?: CommandSchema<TArgs>;
  resultSchema?: CommandSchema<TResult>;
}

/** Location of a validation failure within a payload/schema pair. */
export interface CommandValidationIssue {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message?: string;
  params?: JsonObject;
}

/** Structured validation error used by registry validation APIs. */
export type CommandValidationTarget = 'args' | 'result';
/** Error codes returned by command validation helpers. */
export type CommandValidationErrorCode =
  | 'INVALID_COMMAND_ARGS'
  | 'INVALID_COMMAND_RESULT'
  | 'INVALID_COMMAND_SCHEMA'
  | 'COMMAND_NOT_FOUND';

/** Structured validation error used by registry validation APIs. */
export interface CommandValidationError {
  code: CommandValidationErrorCode;
  commandId: CommandId;
  target?: CommandValidationTarget;
  message: string;
  issues?: CommandValidationIssue[];
}

/** Validation success payload for schema checks. */
export interface CommandValidationSuccess<TValue = unknown> {
  ok: true;
  value?: TValue;
}

/** Validation failure payload for schema checks. */
export interface CommandValidationFailure {
  ok: false;
  error: CommandValidationError;
}

/** Discriminated union returned by command argument/result validators. */
export type CommandValidationResult<TValue = unknown> = CommandValidationSuccess<TValue> | CommandValidationFailure;

/** Deterministic comparator contract used when listing command definitions. */
export type CommandOrderingComparator<TCommand extends Pick<CommandDefinition, 'id'> = CommandDefinition> = (
  left: TCommand,
  right: TCommand
) => number;

/** CRUD and validation contract shared by command registries. */
export interface CommandRegistry<THandler = unknown> {
  register(definition: CommandDefinition, handler?: THandler): void;
  update(definition: CommandDefinition, handler?: THandler): void;
  remove(commandId: CommandId): boolean;
  get(commandId: CommandId): CommandDefinition | undefined;
  list(): CommandDefinition[];
  has(commandId: CommandId): boolean;
  validateArgs(commandId: CommandId, args: unknown): CommandValidationResult;
  validateResult(commandId: CommandId, value: unknown): CommandValidationResult;
}

/**
 * Where an invocation came from.
 *
 * The source selects which enablement verdict applies: the affordance sources
 * (`keybinding`, `palette`, `menu`, `ui`) honour `defaultWhen`, while `plugin`
 * and `remote` do not. It is never a security boundary; permission checks
 * belong to the backend.
 */
export type CommandInvocationSource = 'keybinding' | 'palette' | 'menu' | 'ui' | 'plugin' | 'remote';

/** One request to run one command. */
export interface CommandInvocation<TArgs extends JsonValue = JsonValue> {
  readonly id: CommandId;
  /** Absent arguments are normalized to `null` before validation. */
  readonly args?: TArgs;
  readonly source: CommandInvocationSource;
}

/**
 * Why an invocation failed.
 *
 * Consumers must treat an unrecognized code as a generic failure: 4.1.2 adds a
 * permission code, and older remote clients must still decode results.
 */
export type CommandInvocationErrorCode =
  | CommandValidationErrorCode
  | 'COMMAND_DISABLED'
  | 'INVALID_WHEN_EXPRESSION'
  | 'COMMAND_EXECUTION_FAILED';

/** A structured, serializable invocation failure. */
export interface CommandInvocationError {
  readonly code: CommandInvocationErrorCode;
  readonly commandId: CommandId;
  readonly message: string;
  readonly issues?: readonly CommandValidationIssue[];
}

/** `before-execution` guarantees no handler ran and nothing was emitted to the host. */
export type CommandCancellationStage = 'before-execution' | 'during-execution';

/**
 * How an invocation ended.
 *
 * A discriminated union rather than a `{ok, result, error, cancelled}` record:
 * the record shape admits illegal states such as `ok` together with an error,
 * and a union gives exhaustive checking at every call site.
 */
export type CommandResult<TResult extends JsonValue = JsonValue> =
  | {readonly status: 'ok'; readonly value?: TResult}
  | {readonly status: 'error'; readonly error: CommandInvocationError}
  | {readonly status: 'cancelled'; readonly stage: CommandCancellationStage};

/** Options a caller may pass when invoking a command. */
export interface CommandDispatchOptions {
  readonly signal?: AbortSignal;
}

/**
 * The one way the renderer executes a command.
 *
 * `invoke` never rejects. `TResult` is unchecked unless the definition declares
 * a `resultSchema`.
 */
export interface CommandDispatcher<TOptions extends CommandDispatchOptions = CommandDispatchOptions> {
  invoke<TArgs extends JsonValue = JsonValue, TResult extends JsonValue = JsonValue>(
    invocation: CommandInvocation<TArgs>,
    options?: TOptions
  ): Promise<CommandResult<TResult>>;
}
