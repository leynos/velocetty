/** @file Shared raw config validation helpers for app config and runtime settings loaders. */
import type {rawConfig} from '@shared/types/config';
import type {ParseResult} from './json5-config';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isKeymapValue = (value: unknown): value is string | string[] => typeof value === 'string' || isStringArray(value);

export const isKeymapConfig = (value: unknown): value is Record<string, string | string[]> =>
  isRecord(value) && Object.values(value).every((entry) => isKeymapValue(entry));

export const safeParseRawConfig = (value: unknown): ParseResult<rawConfig> => {
  if (!isRecord(value)) {
    return {success: false, error: new Error('Expected config payload to be an object.')};
  }

  if (value.config !== undefined && !isRecord(value.config)) {
    return {success: false, error: new Error('Expected `config` to be an object when present.')};
  }

  if (value.plugins !== undefined && !isStringArray(value.plugins)) {
    return {success: false, error: new Error('Expected `plugins` to be an array of strings when present.')};
  }

  if (value.localPlugins !== undefined && !isStringArray(value.localPlugins)) {
    return {success: false, error: new Error('Expected `localPlugins` to be an array of strings when present.')};
  }

  if (value.keymaps !== undefined && !isKeymapConfig(value.keymaps)) {
    return {
      success: false,
      error: new Error('Expected `keymaps` values to be strings or string arrays when present.')
    };
  }

  return {success: true, data: value as rawConfig};
};
