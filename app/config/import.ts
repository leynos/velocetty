/** @file Imports and normalizes user and default configuration files. */
import {resolve} from 'node:path';

import JSON5 from 'json5';
import {copySync, existsSync, mkdirpSync, readFileSync, writeFileSync} from 'fs-extra';

import type {rawConfig} from '@shared/types/config';
import notify from '../notify';

import {_init} from './init';
import {cfgDir, cfgPath, defaultCfg, defaultPlatformKeyPath, plugs, schemaFile, schemaPath} from './paths';

let defaultConfig: rawConfig;

const parseConfig = <T>(raw: string): T => JSON5.parse(raw) as T;

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

  const parsedDefaultConfig = parseConfig<rawConfig>(defaultCfgRaw);
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
  const _defaultCfg = parseConfig<rawConfig>(defaultCfgRaw);

  ensureUserConfigFile(defaultCfgRaw);

  // Importing platform specific keymap
  let content = '{}';
  try {
    content = readFileSync(defaultPlatformKeyPath(), 'utf8');
  } catch (err) {
    console.error(err);
  }
  const mapping = parseConfig<Record<string, string | string[]>>(content);
  _defaultCfg.keymaps = mapping;

  // Import user config
  let userCfg: rawConfig;
  try {
    userCfg = parseConfig<rawConfig>(readFileSync(cfgPath, 'utf8'));
  } catch (_err) {
    notify("Couldn't parse config file. Using default config instead.");
    userCfg = parseConfig<rawConfig>(defaultCfgRaw);
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
