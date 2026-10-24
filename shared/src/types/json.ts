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

export const isJsonValue = (value: unknown): value is JsonValue => {
  if (isJsonPrimitive(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }
  return isJsonObject(value);
};

export const isJsonObject = (value: unknown): value is JsonObject => {
  if (!isObject(value) || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((item: unknown) => isJsonValue(item));
};
