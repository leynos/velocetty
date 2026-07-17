/** @file Shared JSON5 parsing and serialization helpers with optional schema validation. */
import JSON5 from 'json5';
import {z} from 'zod';

/** Outcome of a successful schema-validated parse. */
export type ParseSuccess<T> = {
  /** Discriminant confirming the parse succeeded. */
  success: true;
  /** The validated, typed payload. */
  data: T;
};
/** Outcome of a failed schema-validated parse. */
export type ParseFailure = {
  /** Discriminant confirming the parse failed. */
  success: false;
  /** Reason the payload was rejected. */
  error: Error;
};
/** Result of validating a value against a {@link ParseSchema}. */
export type ParseResult<T> = ParseSuccess<T> | ParseFailure;
/** Minimal schema contract this module needs from a validator (e.g. a Zod schema). */
export type ParseSchema<T> = {
  /** Validates an unknown value, returning a typed result rather than throwing. */
  readonly safeParse: (value: unknown) => ParseResult<T>;
};

/** Narrows to a plain object, excluding arrays and `null`, ahead of field-level checks. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Narrows to an array whose every element is a string. */
export const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** Narrows to a keymap map, whose values are either a single binding or a list of bindings. */
export const isKeymapConfig = (value: unknown): value is Record<string, string | string[]> =>
  isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string' || isStringArray(entry));

type FieldValidator = (value: Record<string, unknown>, field: string) => Error | null;

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

const rawConfigSchema = z
  .object({
    config: z.record(z.string(), z.unknown()).optional(),
    plugins: z.array(z.string()).optional(),
    localPlugins: z.array(z.string()).optional(),
    keymaps: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional()
  })
  .passthrough();

const validateFields = (value: Record<string, unknown>): Error | null => {
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

/**
 * Validates a raw config payload's shape, falling back to per-field checks so the
 * error message pinpoints the offending property rather than dumping the raw
 * Zod issue list.
 */
export const validateRawConfig = (value: unknown): ParseResult<Record<string, unknown>> => {
  const parsed = rawConfigSchema.safeParse(value);
  if (parsed.success) {
    return {success: true, data: parsed.data as Record<string, unknown>};
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

/** Recursively sorts object keys so serialized config output is stable and diff-friendly. */
export const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeys(item));
  }

  if (isRecord(value)) {
    const sortedObject: Record<string, unknown> = {};
    Object.keys(value)
      .sort()
      .forEach((key) => {
        sortedObject[key] = sortKeys(value[key]);
      });
    return sortedObject;
  }

  return value;
};

/** Inputs for a schema-validated, non-throwing JSON5 parse. */
export interface ParseJson5Options<T> {
  /** Raw JSON5 text to parse. */
  readonly raw: string;
  /** Human-readable origin of the text, used in warning messages. */
  readonly source: string;
  /** Schema used to validate the parsed payload. */
  readonly schema: ParseSchema<T>;
  /** Value returned when parsing or validation fails. */
  readonly fallback: T;
  /** Noun describing the payload kind, used in warning messages (defaults to `config`). */
  readonly itemType?: string;
}

/** Alias for {@link ParseJson5Options}. */
export type ParseOptions<T> = ParseJson5Options<T>;

/** Parses JSON5 against a schema, logging and falling back instead of throwing on failure. */
export const parseJson5WithSchema = <T>(options: ParseJson5Options<T>): T => {
  const {raw, source, schema, fallback, itemType = 'config'} = options;
  try {
    const parsed = JSON5.parse(raw) as unknown;
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

/** Parses JSON5 against a Zod schema, throwing on parse or validation failure. */
export const parseJson5StrictWithSchema = <T>(raw: string, schema: z.ZodType<T>): T => {
  return schema.parse(JSON5.parse(raw) as unknown);
};

/** Serializes a value as pretty-printed JSON5 with keys sorted for stable diffs. */
export const stringifyJson5 = (value: unknown): string => `${JSON5.stringify(sortKeys(value), null, 2)}\n`;
