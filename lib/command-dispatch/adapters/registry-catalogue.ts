/**
 * @file Catalogue adapter over the renderer command registry.
 *
 * Responsibilities:
 * - Resolve a command definition from the registry, falling back to a host stub
 *   for an identifier that the latest keymap snapshot binds but the registry
 *   does not define.
 * - Validate arguments and results against the resolved definition's schemas.
 *
 * Invariants:
 * - The fallback never writes to the registry. Synthesized definitions would
 *   pollute `list()`, the palette's source of truth, and would need separate
 *   ownership tracking so that removing one did not delete a plugin's handler.
 * - A stub declares no schemas, so a host command admits only `null`
 *   arguments; the interpreter's route gate is what says so.
 *
 * Usage:
 * - `compose.ts` builds one per renderer.
 *
 * Related modules:
 * - `../ports.ts` declares `CommandCatalogue`.
 * - `../../command-registry.ts` is the registry this adapts.
 */
import type {CommandDefinition, CommandId, CommandValidationResult} from '@shared/types/commands';
import {asCommandId} from '@shared/types/commands';
import type {JsonValue} from '@shared/types/json';
import type {CommandCatalogue} from '../ports';

/** The slice of the registry this adapter needs. */
export interface CommandRegistrySource {
  get(commandId: CommandId | string): CommandDefinition | undefined;
  validateArgs(commandId: CommandId | string, args: unknown): CommandValidationResult;
  validateResult(commandId: CommandId | string, value: unknown): CommandValidationResult;
}

export interface RegistryCatalogueDependencies {
  readonly registry: CommandRegistrySource;
  /**
   * Identifiers bound by the latest keymap snapshot.
   *
   * Read on demand rather than captured, so a keymap reload is visible to the
   * next invocation without rebuilding the dispatcher.
   */
  readonly getBoundKeymapCommandIds: () => ReadonlySet<string>;
}

/**
 * The definition a bound-but-undefined command resolves to.
 *
 * `backend` is descriptive only; routing is by handler presence (ADR-007 D-5).
 */
const hostStub = (id: CommandId): CommandDefinition => ({
  id,
  kind: 'backend',
  metadata: {title: id}
});

const notFound = (id: CommandId, target: 'args' | 'result'): CommandValidationResult => ({
  ok: false,
  error: {
    code: 'COMMAND_NOT_FOUND',
    commandId: id,
    target,
    message: `Cannot validate ${target} for unknown command: ${id}`
  }
});

/** Builds the catalogue over the registry and the keymap snapshot. */
export const createRegistryCatalogue = (dependencies: RegistryCatalogueDependencies): CommandCatalogue => {
  const isBoundButUndefined = (id: CommandId): boolean =>
    !dependencies.registry.get(id) && dependencies.getBoundKeymapCommandIds().has(id);

  const resolve = (id: CommandId): CommandDefinition | undefined =>
    dependencies.registry.get(id) ?? (isBoundButUndefined(id) ? hostStub(id) : undefined);

  /** Delegates to the registry, or reports the command as unknown. */
  const requireDefinition = (
    id: CommandId,
    target: 'args' | 'result',
    validate: () => CommandValidationResult
  ): CommandValidationResult => (resolve(id) ? validate() : notFound(id, target));

  return {
    get: (id) => resolve(asCommandId(id)),
    validateArgs: (id, args: JsonValue) => {
      // A keymap-bound command with no registry definition is a host command
      // with no declared schema, so any value passes here. The interpreter's
      // route gate is what restricts a host command to `null` arguments.
      if (isBoundButUndefined(id)) {
        return {ok: true, value: args};
      }
      return requireDefinition(id, 'args', () => dependencies.registry.validateArgs(id, args));
    },
    validateResult: (id, value) =>
      isBoundButUndefined(id)
        ? {ok: true, value}
        : requireDefinition(id, 'result', () => dependencies.registry.validateResult(id, value))
  };
};
