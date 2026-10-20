/** @file JSON value contracts for persisted and transported payloads. */

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

export type JsonObject = {[key: string]: JsonValue};

export const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }
  return isJsonObject(value);
};

export const isJsonObject = (value: unknown): value is JsonObject => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((item) => isJsonValue(item));
};
