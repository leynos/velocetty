/** @file Runtime-safe JSON5 parsing and deterministic serialization helpers for app config I/O. */
import JSON5 from 'json5';

import type {rawConfig} from '@shared/types/config';

type ParseSuccess<T> = {
  success: true;
  data: T;
};

type ParseFailure = {
  success: false;
  error: Error;
};

export type ParseResult<T> = ParseSuccess<T> | ParseFailure;
export type ParseSchema<T> = {
  readonly safeParse: (value: unknown) => ParseResult<T>;
};

export interface ParseOptions<T> {
  readonly source: string;
  readonly schema: ParseSchema<T>;
  readonly fallback: T;
  readonly itemType?: string;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

export const isKeymapConfig = (value: unknown): value is Record<string, string | string[]> =>
  isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string' || isStringArray(entry));

type FieldValidator = (value: unknown) => boolean;
interface FieldValidation {
  readonly field: string;
  readonly validator: FieldValidator;
  readonly errorMessage: string;
}

export const safeParseRawConfig = (value: unknown): ParseResult<rawConfig> => {
  if (!isRecord(value)) {
    return {success: false, error: new Error('Expected config payload to be an object.')};
  }

  const fieldValidations: FieldValidation[] = [
    {
      field: 'config',
      validator: isRecord,
      errorMessage: 'Expected `config` to be an object when present.'
    },
    {
      field: 'plugins',
      validator: isStringArray,
      errorMessage: 'Expected `plugins` to be an array of strings when present.'
    },
    {
      field: 'localPlugins',
      validator: isStringArray,
      errorMessage: 'Expected `localPlugins` to be an array of strings when present.'
    },
    {
      field: 'keymaps',
      validator: isKeymapConfig,
      errorMessage: 'Expected `keymaps` values to be strings or string arrays when present.'
    }
  ];

  for (const {field, validator, errorMessage} of fieldValidations) {
    if (value[field] !== undefined && !validator(value[field])) {
      return {success: false, error: new Error(errorMessage)};
    }
  }

  return {success: true, data: value as rawConfig};
};

export const validateRawConfig = (value: unknown): ParseResult<Record<string, unknown>> => {
  const result = safeParseRawConfig(value);
  if (!result.success) {
    return result;
  }
  return {success: true, data: result.data as Record<string, unknown>};
};

export const parseJson5WithSchema = <T>(raw: string, options: ParseOptions<T>): T => {
  const {source, schema, fallback, itemType = 'config'} = options;
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

export const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeys(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  const sortedObject: Record<string, unknown> = {};
  Object.keys(value)
    .sort()
    .forEach((key) => {
      sortedObject[key] = sortKeys(value[key]);
    });
  return sortedObject;
};

export const stringifyJson5 = (value: unknown): string => `${JSON5.stringify(sortKeys(value), null, 2)}\n`;
