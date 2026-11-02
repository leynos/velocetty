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
 * isJsonValue(new Date()); // false
 * ```
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
 * Narrows a value to a plain `JsonObject` whose members are all JSON values.
 *
 * Arrays are rejected even though `typeof [] === 'object'`, because a JSON
 * object is a map rather than a list.
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
