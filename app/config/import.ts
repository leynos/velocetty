/** @file Imports and normalizes user and default configuration files. */
import {resolve} from 'node:path';

import {copySync, existsSync, mkdirpSync, readFileSync, writeFileSync} from 'fs-extra';

import type {rawConfig} from '@shared/types/config';
import notify from '../notify';
import {parseJson5WithSchema, stringifyJson5, type ParseSchema} from './json5-config';

import {_init} from './init';
import {cfgDir, cfgPath, defaultCfg, defaultPlatformKeyPath, plugs, schemaFile, schemaPath} from './paths';

let defaultConfig: rawConfig;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isKeymapValue = (value: unknown): value is string | string[] => typeof value === 'string' || isStringArray(value);

const isKeymapConfig = (value: unknown): value is Record<string, string | string[]> =>
  isRecord(value) && Object.values(value).every((entry) => isKeymapValue(entry));

type ParseFailure = {success: false; error: Error};
type FieldValidator<T> = (value: unknown) => value is T;

const validateOptionalField = <T>(
  obj: Record<string, unknown>,
  fieldName: string,
  validator: FieldValidator<T>,
  errorMessage: string
): ParseFailure | null => {
  if (obj[fieldName] !== undefined && !validator(obj[fieldName])) {
    return {
      success: false,
      error: new Error(errorMessage)
    };
  }
  return null;
};

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

    const validations: Array<ParseFailure | null> = [
      validateOptionalField(value, 'config', isRecord, 'Expected `config` to be an object when present.'),
      validateOptionalField(
        value,
        'plugins',
        isStringArray,
        'Expected `plugins` to be an array of strings when present.'
      ),
      validateOptionalField(
        value,
        'localPlugins',
        isStringArray,
        'Expected `localPlugins` to be an array of strings when present.'
      ),
      validateOptionalField(
        value,
        'keymaps',
        isKeymapConfig,
        'Expected `keymaps` values to be strings or string arrays when present.'
      )
    ];

    for (const validation of validations) {
      if (validation) {
        return validation;
      }
    }

    return {success: true, data: value as rawConfig};
  }
};

const parseRawConfig = (raw: string, source: string): rawConfig | null => {
  return parseJson5WithSchema(raw, {source, schema: rawConfigSchema, fallback: null, itemType: 'config'});
};

const parseKeymapConfig = (raw: string, source: string): Record<string, string | string[]> => {
  return parseJson5WithSchema(raw, {source, schema: keymapSchema, fallback: {}, itemType: 'keymap'});
};

const stringifyConfig = (config: rawConfig): string => stringifyJson5(config);

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
