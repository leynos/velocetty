/** @file Runtime-safe JSON5 parsing and deterministic serialization helpers for app config I/O. */
import type {rawConfig} from '@shared/types/config';
import {
  isKeymapConfig,
  isRecord,
  isStringArray,
  parseJson5WithSchema as parseJson5WithSchemaShared,
  sortKeys,
  stringifyJson5,
  validateRawConfig
} from '../../shared/src/config/json5-config';
import type {
  ParseFailure,
  ParseOptions,
  ParseResult,
  ParseSchema,
  ParseSuccess
} from '../../shared/src/config/json5-config';

export type {ParseFailure, ParseOptions, ParseResult, ParseSchema, ParseSuccess};
export {isKeymapConfig, isRecord, isStringArray, sortKeys, stringifyJson5, validateRawConfig};

export const safeParseRawConfig = (value: unknown): ParseResult<rawConfig> => {
  const parsed = validateRawConfig(value);
  if (!parsed.success) {
    return parsed;
  }
  return {success: true, data: parsed.data as rawConfig};
};

export const parseJson5WithSchema = <T>(options: ParseOptions<T>): T => parseJson5WithSchemaShared(options);
