/** @file Shared command contracts for metadata, schemas, and validation outcomes. */

/** Stable identifier used across keymaps, menus, dispatchers, and handlers. */
declare const commandIdBrand: unique symbol;
/** Branded string uniquely identifying a registered command. */
export type CommandId = string & {
  /** Phantom brand distinguishing a validated command id from a plain string; absent at runtime. */
  [commandIdBrand]: 'CommandId';
};
/** Execution location for a command handler. */
export type CommandKind = 'frontend' | 'backend';

declare const commandSchemaPayload: unique symbol;

/** JSON Schema payload used to validate command arguments and results. */
export type CommandSchema<TPayload = unknown> = {
  [key: string]: unknown;
  /** Phantom carrier for the validated payload's TypeScript type; not present at runtime. */
  [commandSchemaPayload]?: TPayload;
};

/** UI-facing metadata that makes commands discoverable and explainable. */
export interface CommandMetadata {
  /** Label shown for the command in palettes, menus, and keymap editors. */
  title: string;
  /** Grouping used to cluster related commands in the palette. */
  category?: string;
  /** Longer explanation shown as help text or a tooltip. */
  description?: string;
  /** Extra search terms so the command surfaces under related phrasing. */
  keywords?: string[];
  /** Icon identifier rendered alongside the title in the palette/menu. */
  icon?: string;
}

/** Command contract shared between frontend and backend registries. */
export interface CommandDefinition<TArgs = unknown, TResult = unknown> {
  /** Unique key under which the command is registered and dispatched. */
  id: CommandId;
  /** Palette/menu presentation details for the command. */
  metadata: CommandMetadata;
  /** Which process owns execution, so dispatch can route the invocation correctly. */
  kind: CommandKind;
  /** Default `when` expression gating whether the command is currently enabled. */
  defaultWhen?: string;
  /** Schema used to validate arguments before the handler runs. */
  argsSchema?: CommandSchema<TArgs>;
  /** Schema used to validate the handler's return value. */
  resultSchema?: CommandSchema<TResult>;
}

/** Location of a validation failure within a payload/schema pair. */
export interface CommandValidationIssue {
  /** JSON Pointer to the offending value within the validated payload. */
  instancePath: string;
  /** JSON Pointer to the schema rule that rejected the value. */
  schemaPath: string;
  /** Name of the failed schema rule (e.g. `required`, `type`). */
  keyword: string;
  /** Human-readable explanation of the failure, when the validator supplies one. */
  message?: string;
  /** Rule-specific detail (e.g. allowed values) attached by the validator. */
  params?: Record<string, unknown>;
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
  /** Machine-readable classification for handling or logging the failure. */
  code: CommandValidationErrorCode;
  /** Command whose validation failed. */
  commandId: CommandId;
  /** Whether the failure was on the arguments or the result payload. */
  target?: CommandValidationTarget;
  /** Human-readable summary of the failure. */
  message: string;
  /** Detailed per-field validation issues, when the schema validator reports them. */
  issues?: CommandValidationIssue[];
}

/** Validation success payload for schema checks. */
export interface CommandValidationSuccess<TValue = unknown> {
  /** Discriminant marking this branch as the successful outcome. */
  ok: true;
  /** Validated (and possibly coerced) payload, when the validator returns one. */
  value?: TValue;
}

/** Validation failure payload for schema checks. */
export interface CommandValidationFailure {
  /** Discriminant marking this branch as the failed outcome. */
  ok: false;
  /** Details of why validation failed. */
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
  /** Adds a new command definition (and optional handler) to the registry. */
  register(definition: CommandDefinition, handler?: THandler): void;
  /** Replaces an existing command's definition and/or handler in place. */
  update(definition: CommandDefinition, handler?: THandler): void;
  /** Removes a command from the registry; returns whether it was present. */
  remove(commandId: CommandId): boolean;
  /** Looks up a command's definition by id. */
  get(commandId: CommandId): CommandDefinition | undefined;
  /** Returns all currently registered command definitions. */
  list(): CommandDefinition[];
  /** Reports whether a command id is currently registered. */
  has(commandId: CommandId): boolean;
  /** Validates candidate arguments for a command against its argsSchema. */
  validateArgs(commandId: CommandId, args: unknown): CommandValidationResult;
}
