/** @file Shared JSON5 parsing and serialization helpers with optional schema validation. */
import JSON5 from 'json5';
import type {z} from 'zod';

export const parseJson5WithSchema = <T>(
  raw: string,
  source: string,
  schema: z.ZodType<T>,
  fallback: T,
  itemType: string = 'config'
): T => {
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

export const parseJson5StrictWithSchema = <T>(raw: string, schema: z.ZodType<T>): T => {
  return schema.parse(JSON5.parse(raw) as unknown);
};

export const stringifyJson5 = (value: unknown): string => `${JSON5.stringify(value, null, 2)}\n`;
