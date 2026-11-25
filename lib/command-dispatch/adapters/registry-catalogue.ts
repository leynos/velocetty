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

/** Builds the catalogue over the registry and the keymap snapshot. */
export const createRegistryCatalogue = (dependencies: RegistryCatalogueDependencies): CommandCatalogue => {
  const resolve = (id: CommandId): CommandDefinition | undefined =>
    dependencies.registry.get(id) ?? (dependencies.getBoundKeymapCommandIds().has(id) ? hostStub(id) : undefined);

  return {
    get: (id) => resolve(asCommandId(id)),
    validateArgs: (id, args: JsonValue) => {
      if (!resolve(id)) {
        return {
          ok: false,
          error: {
            code: 'COMMAND_NOT_FOUND',
            commandId: id,
            target: 'args',
            message: `Cannot validate args for unknown command: ${id}`
          }
        };
      }
      return dependencies.registry.validateArgs(id, args);
    },
    validateResult: (id, value) => {
      if (!resolve(id)) {
        return {
          ok: false,
          error: {
            code: 'COMMAND_NOT_FOUND',
            commandId: id,
            target: 'result',
            message: `Cannot validate result for unknown command: ${id}`
          }
        };
      }
      return dependencies.registry.validateResult(id, value);
    }
  };
};
