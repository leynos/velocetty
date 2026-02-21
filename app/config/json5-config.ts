/** @file Runtime-safe JSON5 parsing and deterministic serialization helpers for app config I/O. */
import JSON5 from 'json5';

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const parseJson5WithSchema = <T>(raw: string, options: ParseOptions<T>): T => {
  const {source, schema, fallback, itemType = 'config'} = options;
  try {
    const parsed = JSON5.parse(raw) as unknown;
    const validated = schema.safeParse(parsed);
    if (!validated.success) {
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
