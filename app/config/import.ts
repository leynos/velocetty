/** @file Imports and normalizes user and default configuration files. */
import {resolve} from 'node:path';

import {copySync, existsSync, mkdirpSync, readFileSync, writeFileSync} from 'fs-extra';
import {z} from 'zod';

import type {rawConfig} from '@shared/types/config';
import notify from '../notify';
import {parseJson5WithSchema, safeParseRawConfig, stringifyJson5, type ParseSchema} from './json5-config';

import {_init} from './init';
import {cfgDir, cfgPath, defaultCfg, defaultPlatformKeyPath, plugs, schemaFile, schemaPath} from './paths';

let defaultConfig: rawConfig;
const defaultRawConfigFallback: rawConfig = {
  plugins: [],
  localPlugins: [],
  keymaps: {}
};

const cloneRawConfig = (config: rawConfig): rawConfig => structuredClone(config);

const keymapValueSchema = z.union([z.string(), z.array(z.string())]);
const keymapRecordSchema = z.record(z.string(), keymapValueSchema);

const keymapSchema: ParseSchema<Record<string, string | string[]>> = {
  safeParse: (value) => {
    const parsed = keymapRecordSchema.safeParse(value);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error
      };
    }

    return {success: true, data: parsed.data};
  }
};

const rawConfigSchema: ParseSchema<rawConfig> = {
  safeParse: (value) => safeParseRawConfig(value)
};

const parseRawConfig = (raw: string, source: string): rawConfig | null => {
  return parseJson5WithSchema({raw, source, schema: rawConfigSchema, fallback: null, itemType: 'config'});
};

const parseKeymapConfig = (raw: string, source: string): Record<string, string | string[]> => {
  return parseJson5WithSchema({raw, source, schema: keymapSchema, fallback: {}, itemType: 'keymap'});
};

const stringifyConfig = (config: rawConfig): string => stringifyJson5(config);

const ensureSchemaFile = () => {
  try {
    copySync(schemaPath, resolve(cfgDir, schemaFile), {overwrite: true});
  } catch (err) {
    console.error(err);
  }
};

const ensureUserConfigFile = (defaultConfigTemplate: rawConfig) => {
  if (existsSync(cfgPath)) {
    return;
  }

  console.warn(`[config-import] User config file missing at "${cfgPath}". Bootstrapping from default config template.`);
  try {
    writeFileSync(cfgPath, stringifyConfig(defaultConfigTemplate), 'utf8');
  } catch (error) {
    console.error(`[config-import] Failed to write bootstrapped user config at "${cfgPath}".`, error);
    notify("Couldn't create a user config file. Check permissions and available disk space.");
  }
};

const _importConf = () => {
  console.warn('[config-import] Initializing config import using app-local JSON5 helpers.');
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
  const parsedDefaultConfig = parseRawConfig(defaultCfgRaw, defaultCfg);
  const _defaultCfg =
    parsedDefaultConfig ??
    (() => {
      console.error(
        `[config-import] Failed to parse bundled default config at "${defaultCfg}". Using safe fallback defaults.`
      );
      notify("Couldn't parse the bundled default config. Falling back to safe defaults.");
      return cloneRawConfig(defaultRawConfigFallback);
    })();

  ensureUserConfigFile(_defaultCfg);

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
    console.warn(
      `[config-import] Using default config fallback after user config parse failure. userPath="${cfgPath}" defaultPath="${defaultCfg}"`
    );
    notify("Couldn't parse config file. Using default config instead.");
    userCfg = cloneRawConfig(_defaultCfg);
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
