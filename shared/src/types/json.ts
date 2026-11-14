/** @file JSON value contracts for persisted and transported payloads. */
import {isBoolean, isNumber, isObject, isString} from './guards';

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

export type JsonObject = {[key: string]: JsonValue};

/** The primitive members of `JsonValue`; `null` is one of them. */
type JsonPrimitive = string | number | boolean | null;

/**
 * Narrows a value to a JSON primitive: a string, number, boolean, or `null`.
 *
 * The shared boundary guards carry the primitive contracts, so this module
 * never inspects a representation itself.
 */
const isJsonPrimitive = (value: unknown): value is JsonPrimitive =>
  value === null || isString(value) || isNumber(value) || isBoolean(value);

/**
 * Narrows a value to a `JsonValue`, recursing through arrays and objects.
 *
 * @example
 * ```ts
 * isJsonValue({a: [1, null]}); // true
 * isJsonValue(new Date()); // true
 * ```
 *
 * A `Date` passes because it is a non-array object with no own enumerable
 * members, so it satisfies the structural contract even though it would not
 * survive a JSON round trip. Callers that need to reject such values must
 * validate the shape they actually require.
 */
export const isJsonValue = (value: unknown): value is JsonValue => {
  if (isJsonPrimitive(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }
  return isJsonObject(value);
};

/**
 * Narrows a value to a `JsonObject` whose members are all JSON values.
 *
 * Arrays are rejected even though `typeof [] === 'object'`, because a JSON
 * object is a map rather than a list. The prototype is not inspected, so a
 * class instance with JSON-valued own enumerable members is accepted; this is
 * a structural check, not a proof that the value came from JSON.
 *
 * @example
 * ```ts
 * isJsonObject({a: 1}); // true
 * isJsonObject([1]); // false
 * ```
 */
export const isJsonObject = (value: unknown): value is JsonObject => {
  if (!isObject(value) || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((item: unknown) => isJsonValue(item));
};
