/**
 * @file Encodes the user's parsed config values for the renderer transport.
 *
 * `JSON5.parse` accepts `NaN` and `Infinity`, but the renderer validates the
 * snapshot with a JSON schema, which rejects a payload containing either. Such
 * a file must still load: the tab is where the user repairs the value, and a
 * rejected snapshot would hide the row and its diagnostic. The textual form
 * keeps the key present, so the row stays editable and resettable, while the
 * diagnostics reported beside it are still derived from the parsed file.
 */
import JSON5 from 'json5';

import {isJsonObject, isNumber} from '../utils/runtime-guards';

import type {JsonObject, JsonValue} from '@shared/types/json';

/**
 * Replaces numbers JSON cannot carry with the JSON5 text that denotes them.
 *
 * @param value - A value parsed from the user's file.
 * @returns The value with every non-finite number replaced by its JSON5 text.
 *
 * @example
 * ```ts
 * transportSafeValues({fontSize: NaN, scrollback: [Infinity, 16]});
 * // {fontSize: 'NaN', scrollback: ['Infinity', 16]}
 * ```
 */
const transportSafeValue = (value: JsonValue): JsonValue => {
  if (isNumber(value)) {
    return Number.isFinite(value) ? value : JSON5.stringify(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => transportSafeValue(entry));
  }
  if (isJsonObject(value)) {
    const encoded: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
      encoded[key] = transportSafeValue(entry);
    }
    return encoded;
  }
  return value;
};

/**
 * Encodes the user's `config` object for the transport.
 *
 * Returns a copy, so a caller cannot mutate the parsed document through the
 * snapshot it hands to the renderer.
 *
 * @param values - The `config` object parsed from the file.
 * @returns A copy safe for the renderer's JSON schema.
 *
 * @example
 * ```ts
 * transportSafeValues({fontSize: NaN}); // {fontSize: 'NaN'}
 * ```
 */
export const transportSafeValues = (values: JsonObject): JsonObject => {
  const encoded: JsonObject = {};
  for (const [key, value] of Object.entries(values)) {
    encoded[key] = transportSafeValue(value);
  }
  return encoded;
};
