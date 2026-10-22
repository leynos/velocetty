/** @file Shared JSON5 parsing and serialization helpers with optional schema validation. */
import JSON5 from 'json5';
import {z} from 'zod';
import type {JsonObject, JsonValue} from '../types/json';

export type ParseSuccess<T> = {success: true; data: T};
export type ParseFailure = {success: false; error: Error};
export type ParseResult<T> = ParseSuccess<T> | ParseFailure;
export type ParseSchema<T> = {
  readonly safeParse: (value: JsonValue) => ParseResult<T>;
};

export const isRecord = (value: JsonValue): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: JsonValue): value is string => typeof value === 'string';

export const isStringArray = (value: JsonValue): value is string[] =>
  Array.isArray(value) && value.every((item) => isString(item));

const isKeymapBinding = (value: JsonValue): value is string | string[] => isString(value) || isStringArray(value);

export const isKeymapConfig = (value: JsonValue): value is Record<string, string | string[]> =>
  isRecord(value) && Object.values(value).every((entry) => isKeymapBinding(entry));

type FieldValidator = (value: JsonObject, field: string) => Error | null;

const validateRecordField: FieldValidator = (value, field) => {
  if (value[field] !== undefined && !isRecord(value[field])) {
    return new Error(`Expected \`${field}\` to be an object when present.`);
  }
  return null;
};

const validateStringArrayField: FieldValidator = (value, field) => {
  if (value[field] !== undefined && !isStringArray(value[field])) {
    return new Error(`Expected \`${field}\` to be an array of strings when present.`);
  }
  return null;
};

const validateKeymapField: FieldValidator = (value, field) => {
  if (value[field] !== undefined && !isKeymapConfig(value[field])) {
    return new Error(`Expected \`${field}\` values to be strings or string arrays when present.`);
  }
  return null;
};

const keymapValueSchema = z.union([z.string(), z.array(z.string())]);
const rawConfigSchema = z
  .object({
    config: z.record(z.string(), z.json()).optional(),
    plugins: z.array(z.string()).optional(),
    localPlugins: z.array(z.string()).optional(),
    keymaps: z.record(z.string(), keymapValueSchema).optional()
  })
  .loose();

const validateFields = (value: JsonObject): Error | null => {
  const validators: Array<[string, FieldValidator]> = [
    ['config', validateRecordField],
    ['plugins', validateStringArrayField],
    ['localPlugins', validateStringArrayField],
    ['keymaps', validateKeymapField]
  ];

  for (const [field, validator] of validators) {
    const error = validator(value, field);
    if (error) {
      return error;
    }
  }

  return null;
};

export const validateRawConfig = (value: JsonValue): ParseResult<JsonObject> => {
  const parsed = rawConfigSchema.safeParse(value);
  if (parsed.success) {
    return isRecord(value)
      ? {success: true, data: value}
      : {success: false, error: new Error('Expected config payload to be an object.')};
  }

  if (!isRecord(value)) {
    return {success: false, error: new Error('Expected config payload to be an object.')};
  }

  const fieldError = validateFields(value);
  if (fieldError) {
    return {success: false, error: fieldError};
  }

  return {success: false, error: parsed.error};
};

/**
 * Orders two keys by their UTF-16 code units, matching the default ordering
 * `Array.prototype.sort` applies without a comparator.
 *
 * @example
 * ```ts
 * compareKeys('a', 'b'); // -1
 * compareKeys('b', 'a'); // 1
 * compareKeys('a', 'a'); // 0
 * ```
 */
const compareKeys = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
};

export const sortKeys = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeys(item));
  }

  if (isRecord(value)) {
    // Iterate entries rather than re-indexing the source object: `JsonObject`
    // is an index signature, so a key from `Object.keys` narrows to
    // `JsonValue | undefined` and the lookup would need a non-null assertion.
    // Sorting the entries keeps the round-trip deterministic either way.
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => compareKeys(left, right))
        .map(([key, entry]) => [key, sortKeys(entry)])
    );
  }

  return value;
};

export interface ParseJson5Options<T> {
  readonly raw: string;
  readonly source: string;
  readonly schema: ParseSchema<T>;
  readonly fallback: T;
  readonly itemType?: string;
}

export const parseJson5WithSchema = <T>(options: ParseJson5Options<T>): T => {
  const {raw, source, schema, fallback, itemType = 'config'} = options;
  try {
    // SAFETY: JSON5.parse can only produce JSON5 primitives, arrays, and objects.
    const parsed = JSON5.parse(raw) as JsonValue;
    const validated = schema.safeParse(parsed);
    if (validated.success === false) {
      console.warn(`Invalid JSON5 ${itemType} shape from ${source}.`, validated.error);
      return fallback;
    }
    return validated.data;
  } catch (error) {
    console.warn(`Failed to parse JSON5 ${itemType} from ${source}.`, error);
    return fallback;
  }
};

export const parseJson5StrictWithSchema = <T>(raw: string, schema: z.ZodType<T>): T => {
  return schema.parse(JSON5.parse(raw));
};

export const stringifyJson5 = (value: JsonValue): string => `${JSON5.stringify(sortKeys(value), null, 2)}\n`;
