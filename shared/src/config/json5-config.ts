/** @file Shared JSON5 parsing and serialization helpers with optional schema validation. */
import JSON5 from 'json5';
import {z} from 'zod';

type ParseSuccess<T> = {success: true; data: T};
type ParseFailure = {success: false; error: Error};
export type ParseResult<T> = ParseSuccess<T> | ParseFailure;
export type ParseSchema<T> = {
  readonly safeParse: (value: unknown) => ParseResult<T>;
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

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

export const validateRawConfig = (value: unknown): ParseResult<Record<string, unknown>> => {
  const parsed = rawConfigSchema.safeParse(value);
  if (!parsed.success) {
    if (!isRecord(value)) {
      return {success: false, error: new Error('Expected config payload to be an object.')};
    }

    const validators: Array<[string, FieldValidator]> = [
      ['config', validateRecordField],
      ['plugins', validateStringArrayField],
      ['localPlugins', validateStringArrayField],
      ['keymaps', validateKeymapField]
    ];

    for (const [field, validator] of validators) {
      const error = validator(value, field);
      if (error) {
        return {success: false, error};
      }
    }

    return {success: false, error: parsed.error};
  }

  return {success: true, data: parsed.data as Record<string, unknown>};
};

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

export const parseJson5StrictWithSchema = <T>(raw: string, schema: z.ZodType<T>): T => {
  return schema.parse(JSON5.parse(raw) as unknown);
};

export const stringifyJson5 = (value: unknown): string => `${JSON5.stringify(sortKeys(value), null, 2)}\n`;
