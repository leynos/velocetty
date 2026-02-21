/** @file Runtime plugin manifest evaluation and JSON5-backed settings persistence. */
import {readFileSync, writeFileSync} from 'node:fs';

import JSON5 from 'json5';
import isEqual from 'lodash/isEqual';
import merge from 'lodash/merge';

import type {CommandDefinition} from '@shared/types/commands';
import type {configOptions, rawConfig} from '@shared/types/config';
import {runtimePluginManifests, type RuntimePluginManifest} from './golden-path-demo';

type RuntimePluginSettings = Record<string, unknown>;
type RuntimePluginSettingsNamespace = Record<string, RuntimePluginSettings>;
type ReadTextFile = (path: string, encoding: BufferEncoding) => string;
type WriteTextFile = (path: string, content: string, encoding: BufferEncoding) => void;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asSettingsRecord = (value: unknown): RuntimePluginSettings => (isRecord(value) ? value : {});

const cloneValue = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const findRuntimePluginManifest = (pluginId: string): RuntimePluginManifest | undefined =>
  runtimePluginManifests.find((manifest) => manifest.id === pluginId);

const getDefaultConfigPath = (): string => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {cfgPath} = require('../config/paths') as typeof import('../config/paths');
  return cfgPath;
};

const getConfigPluginNamespace = (cfg: configOptions): RuntimePluginSettingsNamespace => {
  return isRecord(cfg.plugins) ? (cfg.plugins as RuntimePluginSettingsNamespace) : {};
};

const resolvePluginSettings = (cfg: configOptions, manifest: RuntimePluginManifest): RuntimePluginSettings => {
  const namespace = getConfigPluginNamespace(cfg);
  return merge({}, manifest.settingsDefaults, asSettingsRecord(namespace[manifest.id])) as RuntimePluginSettings;
};

const parseConfigJson5 = (raw: string): rawConfig => {
  const parsed = JSON5.parse(raw) as unknown;
  return isRecord(parsed) ? (parsed as rawConfig) : {};
};

const stringifyConfigJson5 = (cfg: rawConfig): string => `${JSON5.stringify(cfg, null, 2)}\n`;

const ensureConfigSection = (cfg: rawConfig): configOptions => {
  if (!isRecord(cfg.config)) {
    cfg.config = {} as configOptions;
  }
  return cfg.config as configOptions;
};

const ensureSettingsNamespace = (cfg: configOptions): RuntimePluginSettingsNamespace => {
  if (!isRecord(cfg.plugins)) {
    cfg.plugins = {};
  }
  return cfg.plugins as RuntimePluginSettingsNamespace;
};

const isRuntimePluginManifestEnabled = (cfg: configOptions, manifest: RuntimePluginManifest): boolean => {
  const resolvedSettings = resolvePluginSettings(cfg, manifest);
  const enabled = resolvedSettings.enabled;
  return typeof enabled === 'boolean' ? enabled : true;
};

/** Returns resolved settings for a runtime plugin from in-memory config state. */
export const getRuntimePluginSettings = (cfg: configOptions, pluginId: string): RuntimePluginSettings => {
  const manifest = findRuntimePluginManifest(pluginId);
  if (!manifest) {
    return asSettingsRecord(getConfigPluginNamespace(cfg)[pluginId]);
  }
  return resolvePluginSettings(cfg, manifest);
};

/** Returns command definitions contributed by currently enabled runtime plugins. */
export const getRuntimePluginCommandDefinitions = (cfg: configOptions): CommandDefinition[] => {
  return runtimePluginManifests.flatMap((manifest) => {
    if (!isRuntimePluginManifestEnabled(cfg, manifest)) {
      return [];
    }
    return manifest.commands.map((command) => cloneValue(command));
  });
};

/** Returns keybinding contributions from currently enabled runtime plugins. */
export const getRuntimePluginKeybindings = (cfg: configOptions): Record<string, string[]> => {
  return runtimePluginManifests.reduce<Record<string, string[]>>((accumulator, manifest) => {
    if (!isRuntimePluginManifestEnabled(cfg, manifest)) {
      return accumulator;
    }

    Object.keys(manifest.keybindings).forEach((commandId) => {
      accumulator[commandId] = [...manifest.keybindings[commandId]];
    });

    return accumulator;
  }, {});
};

/**
 * Merges runtime keybinding contributions with resolved keymaps.
 *
 * Resolved keymaps from `config.getKeymaps()` already include default+user
 * precedence, so they must override runtime defaults for the same command.
 */
export const mergeRuntimePluginKeybindings = (
  resolvedKeymaps: Record<string, string[]>,
  runtimeKeybindings: Record<string, string[]>
): Record<string, string[]> => ({
  ...runtimeKeybindings,
  ...resolvedKeymaps
});

/**
 * Ensures runtime plugin settings defaults are present in the JSON5 config file.
 *
 * Returns the persisted runtime plugin namespace after defaults have been
 * merged.
 */
export const ensureRuntimePluginSettingsPersisted = (
  configFilePath: string = getDefaultConfigPath(),
  readFile: ReadTextFile = readFileSync,
  writeFile: WriteTextFile = writeFileSync
): RuntimePluginSettingsNamespace => {
  const rawConfig = parseConfigJson5(readFile(configFilePath, 'utf8'));
  const configSection = ensureConfigSection(rawConfig);
  const namespace = ensureSettingsNamespace(configSection);

  let didChange = false;

  runtimePluginManifests.forEach((manifest) => {
    const existing = asSettingsRecord(namespace[manifest.id]);
    const merged = merge({}, manifest.settingsDefaults, existing) as RuntimePluginSettings;
    if (!isEqual(existing, merged)) {
      namespace[manifest.id] = merged;
      didChange = true;
    }
  });

  if (didChange) {
    writeFile(configFilePath, stringifyConfigJson5(rawConfig), 'utf8');
  }

  return namespace;
};

/**
 * Persists runtime plugin enabled state in JSON5 config under
 * `config.plugins.<pluginId>.enabled`.
 */
export const setRuntimePluginEnabledPersisted = (
  pluginId: string,
  enabled: boolean,
  configFilePath: string = getDefaultConfigPath(),
  readFile: ReadTextFile = readFileSync,
  writeFile: WriteTextFile = writeFileSync
): RuntimePluginSettings => {
  const rawConfig = parseConfigJson5(readFile(configFilePath, 'utf8'));
  const configSection = ensureConfigSection(rawConfig);
  const namespace = ensureSettingsNamespace(configSection);
  const manifestDefaults = findRuntimePluginManifest(pluginId)?.settingsDefaults ?? {};
  const existing = asSettingsRecord(namespace[pluginId]);
  const merged = merge({}, manifestDefaults, existing, {enabled}) as RuntimePluginSettings;

  if (!isEqual(existing, merged)) {
    namespace[pluginId] = merged;
    writeFile(configFilePath, stringifyConfigJson5(rawConfig), 'utf8');
  }

  return merged;
};
