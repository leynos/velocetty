/** @file Imports and normalizes user and default configuration files. */
import {resolve} from 'node:path';

import JSON5 from 'json5';
import {copySync, existsSync, mkdirpSync, readFileSync, writeFileSync} from 'fs-extra';
import {z} from 'zod';

import type {rawConfig} from '@shared/types/config';
import notify from '../notify';

import {_init} from './init';
import {cfgDir, cfgPath, defaultCfg, defaultPlatformKeyPath, plugs, schemaFile, schemaPath} from './paths';

let defaultConfig: rawConfig;

const keymapValueSchema = z.union([z.string(), z.array(z.string())]);
const keymapSchema = z.record(z.string(), keymapValueSchema);
const rawConfigSchema = z
  .object({
    config: z.record(z.string(), z.unknown()).optional(),
    plugins: z.array(z.string()).optional(),
    localPlugins: z.array(z.string()).optional(),
    keymaps: keymapSchema.optional()
  })
  .passthrough();

const parseRawConfig = (raw: string, source: string): rawConfig | null => {
  try {
    const parsed = JSON5.parse(raw) as unknown;
    const validated = rawConfigSchema.safeParse(parsed);
    if (!validated.success) {
      console.warn(`Invalid JSON5 config shape from ${source}.`, validated.error);
      return null;
    }
    return validated.data as rawConfig;
  } catch (error) {
    console.warn(`Failed to parse JSON5 config from ${source}.`, error);
    return null;
  }
};

const parseKeymapConfig = (raw: string, source: string): Record<string, string | string[]> => {
  try {
    const parsed = JSON5.parse(raw) as unknown;
    const validated = keymapSchema.safeParse(parsed);
    if (!validated.success) {
      console.warn(`Invalid keymap JSON5 shape from ${source}.`, validated.error);
      return {};
    }
    return validated.data;
  } catch (error) {
    console.warn(`Failed to parse keymap JSON5 from ${source}.`, error);
    return {};
  }
};

const stringifyConfig = (value: unknown) => `${JSON5.stringify(value, null, 2)}\n`;

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
