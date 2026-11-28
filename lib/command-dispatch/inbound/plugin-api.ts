/**
 * @file The command facade plugins receive.
 *
 * Responsibilities:
 * - Fix `source: 'plugin'`, so a plugin cannot claim to be a keybinding or a
 *   UI control.
 * - Reject non-JSON arguments before admission, because a plugin runs in the
 *   same process and could otherwise pass a function or a class instance that
 *   the schema validator would silently accept as an object.
 * - Accept no trigger event: a plugin invocation has no keyboard event.
 *
 * Invariants:
 * - Nothing reaches the dispatcher that would not survive serialization.
 * - The returned promise never rejects.
 *
 * Usage:
 * - `lib/components/terms.tsx` exposes the facade as
 *   `this.terms.invokeCommand(id, args, {signal})`.
 *
 * Related modules:
 * - `../dispatcher.ts` is the dispatcher this adapts.
 * - `PLUGINS.md` documents the facade for plugin authors.
 */
import {asCommandId, type CommandId, type CommandResult} from '@shared/types/commands';
import type {JsonValue} from '@shared/types/json';
import {isJsonObject, isJsonValue} from '@shared/types/json';
import type {InterpretingDispatcher} from '../dispatcher';
import type {RendererExecutionContext} from '../adapters/renderer-executor';

/**
 * Whether a value would survive the wire as JSON.
 *
 * `isJsonValue` admits a class instance whose own enumerable properties happen
 * to be JSON values, because it checks shape rather than provenance. A plugin
 * runs in the same process as the renderer, so it can hand over exactly such an
 * instance; rejecting a non-plain prototype here is what keeps the promise that
 * plugin arguments are serializable.
 */
const isTransferableJsonValue = (value: unknown, seen: Set<object> = new Set()): value is JsonValue => {
  if (Array.isArray(value) || isJsonObject(value)) {
    // A cycle is not JSON: reject it here rather than recursing until the
    // stack overflows, which would escape as an unhandled exception.
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    if (Array.isArray(value)) {
      return value.every((item: unknown) => isTransferableJsonValue(item, seen));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    return Object.values(value).every((item: unknown) => isTransferableJsonValue(item, seen));
  }
  return isJsonValue(value);
};

/** Options a plugin may pass. */
export interface PluginInvokeOptions {
  readonly signal?: AbortSignal;
}

/** The facade exposed on `terms.invokeCommand`. */
export type PluginCommandApi = (
  id: CommandId | string,
  args?: JsonValue,
  options?: PluginInvokeOptions
) => Promise<CommandResult>;

/**
 * The facade used when no dispatcher is available.
 *
 * A plugin calling `terms.invokeCommand` outside the application tree gets a
 * structured failure rather than an exception, matching `invoke`'s contract.
 */
export const unavailablePluginCommandApi: PluginCommandApi = async (id) => ({
  status: 'error',
  error: {
    code: 'COMMAND_EXECUTION_FAILED',
    commandId: asCommandId(id),
    message: `No command dispatcher is available for: ${id}`
  }
});

/**
 * Builds the plugin facade over a dispatcher.
 *
 * The identifier is taken as a string so a plugin can pass a plain literal;
 * the dispatcher's catalogue treats identifiers as opaque values.
 */
export const createPluginCommandApi =
  (dispatcher: InterpretingDispatcher<RendererExecutionContext>): PluginCommandApi =>
  async (id, args, options) => {
    const commandId = asCommandId(id);

    if (args !== undefined && !isTransferableJsonValue(args)) {
      return {
        status: 'error',
        error: {
          code: 'INVALID_COMMAND_ARGS',
          commandId,
          message: `Plugin arguments for ${commandId} are not JSON values`
        }
      };
    }

    return dispatcher.invoke(
      {id: commandId, args: args ?? null, source: 'plugin'},
      options?.signal ? {signal: options.signal} : {},
      {triggerEvent: undefined}
    );
  };
