/** @file Shared command contracts for metadata, schemas, and validation outcomes. */

/** Stable identifier used across keymaps, menus, dispatchers, and handlers. */
export type CommandId = string;

declare const commandSchemaPayload: unique symbol;

/** JSON Schema payload used to validate command arguments and results. */
export type CommandSchema<TPayload = unknown> = {
  [key: string]: unknown;
  [commandSchemaPayload]?: TPayload;
};

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
  kind: 'frontend' | 'backend';
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
  params?: Record<string, unknown>;
}

/** Structured validation error used by registry validation APIs. */
export interface CommandValidationError {
  code: 'INVALID_COMMAND_ARGS' | 'INVALID_COMMAND_RESULT';
  commandId: CommandId;
  target: 'args' | 'result';
  message: string;
  issues: CommandValidationIssue[];
}

/** Validation success payload for schema checks. */
export interface CommandValidationSuccess<TValue = unknown> {
  ok: true;
  value: TValue;
}

/** Validation failure payload for schema checks. */
export interface CommandValidationFailure {
  ok: false;
  error: CommandValidationError;
}

/** Discriminated union returned by command argument/result validators. */
export type CommandValidationResult<TValue = unknown> =
  | CommandValidationSuccess<TValue>
  | CommandValidationFailure;

/** Deterministic comparator contract used when listing command definitions. */
export type CommandOrderingComparator<TCommand extends Pick<CommandDefinition, 'id'> = CommandDefinition> = (
  left: TCommand,
  right: TCommand
) => number;
