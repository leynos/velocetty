/**
 * @file App-local runtime guards for values crossing typed boundaries.
 *
 * These guards mirror the shared guards in `shared/src/types/guards.ts` and
 * `shared/src/types/json.ts`. The duplication is deliberate: `app/` is
 * compiled to CommonJS under `dist/app`, where the `@shared/*` path alias is a
 * type-checking convenience with nothing materialized at runtime. A bare
 * `@shared/*` value import from an `app/` module therefore loads correctly
 * under `tsgo` and throws `MODULE_NOT_FOUND` in the packaged application. See
 * the alias rule in `docs/developers-guide.md`.
 *
 * Types stay shared. `JsonObject` and `JsonValue` arrive through `import type`,
 * which `tsgo` erases, so the contracts cannot drift; only the runtime
 * predicates are local. `test/unit/app-runtime-guards-parity.test.ts` holds the
 * two implementations to the same answers.
 *
 * @example
 * ```ts
 * const parsed: unknown = JSON.parse(raw);
 * if (isJsonObject(parsed)) {
 *   // `parsed` is a JsonObject here.
 * }
 * ```
 */

import type {JsonObject, JsonValue} from '@shared/types/json';

/** Narrows a value to a string. */
export const isString = (value: unknown): value is string => typeof value === 'string';

/** Narrows a value to a number, including non-finite numbers. */
export const isNumber = (value: unknown): value is number => typeof value === 'number';

/** Narrows a value to a boolean. */
export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

/** Narrows a value to a callable. */
export const isFunction = (value: unknown): value is (...args: never[]) => void => typeof value === 'function';

/**
 * Narrows a value to a non-null object.
 *
 * Arrays satisfy this guard, matching `typeof` semantics. Callers that need a
 * record rather than a list must additionally reject arrays; `isJsonObject`
 * already does.
 */
export const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null;

/** Narrows a value to a JSON primitive: a string, number, boolean, or `null`. */
const isJsonPrimitive = (value: unknown): boolean =>
  value === null || isString(value) || isNumber(value) || isBoolean(value);

/** Narrows a value to a JSON value, recursing through arrays and objects. */
export const isJsonValue = (value: unknown): value is JsonValue => {
  if (isJsonPrimitive(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }
  return isJsonObject(value);
};

/** Narrows a value to a JSON object, rejecting arrays and non-objects. */
export const isJsonObject = (value: unknown): value is JsonObject => {
  if (!isObject(value) || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((item) => isJsonValue(item));
};
