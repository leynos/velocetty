/** @file Runtime plugin manifest evaluation and JSON5-backed settings persistence. */
import {readFileSync, writeFileSync} from 'node:fs';

import isEqual from 'lodash/isEqual';
import merge from 'lodash/merge';
import {cfgPath} from '../config/paths';
import {isRecord} from '../config/json5-config';
import {
  applyPluginSettingsPatches,
  json5Document,
  pluginId as toPluginId,
  parseConfigJson5Strict,
  type PluginPersistencePatch
} from './plugin-runtime-json5-roundtrip';

import type {CommandDefinition} from '@shared/types/commands';
import type {configOptions, rawConfig} from '@shared/types/config';
import {runtimePluginManifests, type RuntimePluginManifest} from './golden-path-demo';

type RuntimePluginSettings = Record<string, unknown>;
type RuntimePluginSettingsNamespace = Record<string, RuntimePluginSettings>;
type ReadTextFile = (path: string, encoding: BufferEncoding) => string;
type WriteTextFile = (path: string, content: string, encoding: BufferEncoding) => void;
type PersistenceOptions = {
  configFilePath?: string;
  readFile?: ReadTextFile;
  writeFile?: WriteTextFile;
};

const cloneValue = <T>(value: T): T => structuredClone(value);

const findRuntimePluginManifest = (pluginId: string): RuntimePluginManifest | undefined =>
  runtimePluginManifests.find((manifest) => manifest.id === pluginId);

const getDefaultConfigPath = (): string => cfgPath;

const getPluginsNamespace = (cfg: configOptions): RuntimePluginSettingsNamespace => {
  return isRecord(cfg.plugins) ? (cfg.plugins as RuntimePluginSettingsNamespace) : {};
};

/**
 * Returns the runtime plugin namespace, creating it in place when absent.
 *
 * This helper mutates `cfg` in place by initializing and assigning
 * `cfg.config` (as `configOptions`) and `cfg.config.plugins` (as
 * `RuntimePluginSettingsNamespace`) when either value is missing or invalid.
 * Callers that require immutability should pass a copy.
 */
const getOrInitPluginsNamespace = (cfg: rawConfig): RuntimePluginSettingsNamespace => {
  if (!isRecord(cfg.config)) {
    cfg.config = {} as configOptions;
  }
  const configSection = cfg.config as configOptions;
  if (!isRecord(configSection.plugins)) {
    configSection.plugins = {};
  }
  return configSection.plugins as RuntimePluginSettingsNamespace;
};

const resolvePersistenceOptions = (options: PersistenceOptions = {}) => {
  const {configFilePath = getDefaultConfigPath(), readFile = readFileSync, writeFile = writeFileSync} = options;
  return {configFilePath, readFile, writeFile};
};

const isRuntimePluginManifestEnabled = (cfg: configOptions, manifest: RuntimePluginManifest): boolean => {
  const namespace = getPluginsNamespace(cfg);
  const existing = namespace[manifest.id];
  const resolvedSettings = merge(
    {},
    manifest.settingsDefaults,
    isRecord(existing) ? existing : {}
  ) as RuntimePluginSettings;
  const enabled = resolvedSettings.enabled;
  return typeof enabled === 'boolean' ? enabled : true;
};

/** Returns resolved settings for a runtime plugin from in-memory config state. */
export const getRuntimePluginSettings = (cfg: configOptions, pluginId: string): RuntimePluginSettings => {
  const namespace = getPluginsNamespace(cfg);
  const existing = namespace[pluginId];
  const manifest = findRuntimePluginManifest(pluginId);
  if (!manifest) {
    return isRecord(existing) ? existing : {};
  }
  return merge({}, manifest.settingsDefaults, isRecord(existing) ? existing : {}) as RuntimePluginSettings;
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
  options: PersistenceOptions = {}
): RuntimePluginSettingsNamespace => {
  const {configFilePath, readFile, writeFile} = resolvePersistenceOptions(options);
  try {
    const rawConfigText = readFile(configFilePath, 'utf8');
    const rawConfig = parseConfigJson5Strict(json5Document(rawConfigText));
    if (!rawConfig) {
      console.error(`Failed to parse runtime plugin config at "${configFilePath}". Returning empty namespace.`);
      return {};
    }
    const namespace = getOrInitPluginsNamespace(rawConfig);

    const patches: PluginPersistencePatch[] = [];

    runtimePluginManifests.forEach((manifest) => {
      const existing = isRecord(namespace[manifest.id]) ? namespace[manifest.id] : {};
      const merged = merge({}, manifest.settingsDefaults, existing) as RuntimePluginSettings;
      if (!isEqual(existing, merged)) {
        namespace[manifest.id] = merged;
        patches.push({pluginId: toPluginId(manifest.id), settings: merged});
      }
    });

    if (patches.length > 0) {
      const patchedContent = applyPluginSettingsPatches(json5Document(rawConfigText), patches);
      if (!patchedContent) {
        console.error(
          `Failed to apply runtime plugin settings patch for "${configFilePath}". Skipping write to preserve user formatting.`
        );
      } else {
        writeFile(configFilePath, patchedContent, 'utf8');
      }
    }

    return namespace;
  } catch (error) {
    console.error(
      `Failed to persist runtime plugin settings defaults from "${configFilePath}". Returning empty namespace.`,
      error
    );
    return {};
  }
};

/**
 * Persists runtime plugin enabled state in JSON5 config under
 * `config.plugins.<pluginId>.enabled`.
 */
export const setRuntimePluginEnabledPersisted = (
  pluginId: string,
  enabled: boolean,
  options: PersistenceOptions = {}
): RuntimePluginSettings => {
  const {configFilePath, readFile, writeFile} = resolvePersistenceOptions(options);
  const manifestDefaults = findRuntimePluginManifest(pluginId)?.settingsDefaults ?? {};
  const fallbackSettings = merge({}, manifestDefaults, {enabled}) as RuntimePluginSettings;

  try {
    const rawConfigText = readFile(configFilePath, 'utf8');
    const rawConfig = parseConfigJson5Strict(json5Document(rawConfigText));
    if (!rawConfig) {
      console.error(`Failed to parse runtime plugin config at "${configFilePath}". Returning fallback settings.`);
      return fallbackSettings;
    }

    const namespace = getOrInitPluginsNamespace(rawConfig);
    const existing = isRecord(namespace[pluginId]) ? namespace[pluginId] : {};
    const merged = merge({}, manifestDefaults, existing, {enabled}) as RuntimePluginSettings;

    if (!isEqual(existing, merged)) {
      namespace[pluginId] = merged;
      const patchedContent = applyPluginSettingsPatches(json5Document(rawConfigText), [
        {pluginId: toPluginId(pluginId), settings: merged}
      ]);
      if (!patchedContent) {
        console.error(
          `Failed to apply runtime plugin enabled patch for "${configFilePath}". Skipping write to preserve user formatting.`
        );
      } else {
        writeFile(configFilePath, patchedContent, 'utf8');
      }
    }

    return merged;
  } catch (error) {
    console.error(
      `Failed to persist runtime plugin enabled state for "${pluginId}" in "${configFilePath}". Returning fallback settings.`,
      error
    );
    return fallbackSettings;
  }
};
