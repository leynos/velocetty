/** @file Imports and normalizes user and default configuration files. */
import {resolve} from 'node:path';

import {copySync, existsSync, mkdirpSync, readFileSync, writeFileSync} from 'fs-extra';
import JSON5 from 'json5';

import type {rawConfig} from '@shared/types/config';
import notify from '../notify';

import {_init} from './init';
import {cfgDir, cfgPath, defaultCfg, defaultPlatformKeyPath, plugs, schemaFile, schemaPath} from './paths';

let defaultConfig: rawConfig;

type ParseSuccess<T> = {
  success: true;
  data: T;
};

type ParseFailure = {
  success: false;
  error: Error;
};

type ParseResult<T> = ParseSuccess<T> | ParseFailure;
type ParseSchema<T> = {
  safeParse: (value: unknown) => ParseResult<T>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isKeymapValue = (value: unknown): value is string | string[] => typeof value === 'string' || isStringArray(value);

const isKeymapConfig = (value: unknown): value is Record<string, string | string[]> =>
  isRecord(value) && Object.values(value).every((entry) => isKeymapValue(entry));

const keymapSchema: ParseSchema<Record<string, string | string[]>> = {
  safeParse: (value) => {
    if (!isKeymapConfig(value)) {
      return {
        success: false,
        error: new Error('Expected keymap object values to be strings or string arrays.')
      };
    }

    return {success: true, data: value};
  }
};

const rawConfigSchema: ParseSchema<rawConfig> = {
  safeParse: (value) => {
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
  }
};

interface ParseOptions<T> {
  readonly source: string;
  readonly schema: ParseSchema<T>;
  readonly fallback: T;
  readonly itemType?: string;
}

const parseJson5WithSchema = <T>(raw: string, options: ParseOptions<T>): T => {
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

const parseRawConfig = (raw: string, source: string): rawConfig | null => {
  return parseJson5WithSchema(raw, {source, schema: rawConfigSchema, fallback: null, itemType: 'config'});
};

const parseKeymapConfig = (raw: string, source: string): Record<string, string | string[]> => {
  return parseJson5WithSchema(raw, {source, schema: keymapSchema, fallback: {}, itemType: 'keymap'});
};

const sortKeys = (value: unknown): unknown => {
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

const stringifyConfig = (config: rawConfig): string => `${JSON5.stringify(sortKeys(config), null, 2)}\n`;

const ensureSchemaFile = () => {
  try {
    copySync(schemaPath, resolve(cfgDir, schemaFile), {overwrite: true});
  } catch (err) {
    console.error(err);
  }
};

const ensureUserConfigFile = (defaultCfgRaw: string) => {
  if (existsSync(cfgPath)) {
    return;
  }

  const parsedDefaultConfig = parseRawConfig(defaultCfgRaw, 'default config bootstrap') ?? {};
  writeFileSync(cfgPath, stringifyConfig(parsedDefaultConfig), 'utf8');
};

const _importConf = () => {
  // init plugin directories if not present
  mkdirpSync(plugs.base);
  mkdirpSync(plugs.local);
  ensureSchemaFile();

  let defaultCfgRaw = '{}';
  try {
    defaultCfgRaw = readFileSync(defaultCfg, 'utf8');
  } catch (err) {
    console.log(err);
  }
  const _defaultCfg = parseRawConfig(defaultCfgRaw, defaultCfg) ?? {};

  ensureUserConfigFile(defaultCfgRaw);

  // Importing platform specific keymap
  let content = '{}';
  try {
    content = readFileSync(defaultPlatformKeyPath(), 'utf8');
  } catch (err) {
    console.error(err);
  }
  const mapping = parseKeymapConfig(content, defaultPlatformKeyPath());
  _defaultCfg.keymaps = mapping;

  // Import user config
  let userCfg: rawConfig | null;
  try {
    userCfg = parseRawConfig(readFileSync(cfgPath, 'utf8'), cfgPath);
  } catch (_err) {
    userCfg = null;
  }

  if (!userCfg) {
    notify("Couldn't parse config file. Using default config instead.");
    userCfg = parseRawConfig(defaultCfgRaw, 'default config fallback') ?? {};
  }

  return {userCfg, defaultCfg: _defaultCfg};
};

export const _import = () => {
  const imported = _importConf();
  defaultConfig = imported.defaultCfg;
  const result = _init(imported.userCfg, imported.defaultCfg);
  return result;
};

export const getDefaultConfig = () => {
  if (!defaultConfig) {
    defaultConfig = _importConf().defaultCfg;
  }
  return defaultConfig;
};
