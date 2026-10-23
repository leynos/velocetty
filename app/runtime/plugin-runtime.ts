/** @file Runtime plugin manifest evaluation and JSON5-backed settings persistence. */
import {readFileSync, writeFileSync} from 'node:fs';

import isEqual from 'lodash/isEqual';
import merge from 'lodash/merge';
import {cfgPath} from '../config/paths';
import type {JsonObject} from '@shared/types/json';
import {isBoolean, isJsonObject} from '../utils/runtime-guards';
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

type RuntimePluginSettingsNamespace = Record<string, JsonObject>;
export type KeybindingConflict = {
  readonly keys: string;
  readonly commands: readonly string[];
};
type ReadTextFile = (path: string, encoding: BufferEncoding) => string;
type WriteTextFile = (path: string, content: string, encoding: BufferEncoding) => void;
type PersistenceOptions = {
  configFilePath?: string;
  readFile?: ReadTextFile;
  writeFile?: WriteTextFile;
};

const cloneValue = <T>(value: T): T => structuredClone(value);
const compareLexical = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

const findRuntimePluginManifest = (pluginId: string): RuntimePluginManifest | undefined =>
  runtimePluginManifests.find((manifest) => manifest.id === pluginId);

const getDefaultConfigPath = (): string => cfgPath;

const getPluginsNamespace = (cfg: Pick<configOptions, 'plugins'>): RuntimePluginSettingsNamespace => {
  return cfg.plugins ?? {};
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
  let configSection = cfg.config;
  if (!configSection) {
    configSection = {};
    cfg.config = configSection;
  }

  let pluginsNamespace = configSection.plugins;
  if (!pluginsNamespace) {
    pluginsNamespace = {};
    configSection.plugins = pluginsNamespace;
  }

  return pluginsNamespace;
};

const resolvePersistenceOptions = (options: PersistenceOptions = {}) => {
  const {configFilePath = getDefaultConfigPath(), readFile = readFileSync, writeFile = writeFileSync} = options;
  return {configFilePath, readFile, writeFile};
};

const isRuntimePluginManifestEnabled = (
  cfg: Pick<configOptions, 'plugins'>,
  manifest: RuntimePluginManifest
): boolean => {
  const namespace = getPluginsNamespace(cfg);
  const existing = namespace[manifest.id];
  const resolvedSettings = merge(
    {},
    manifest.settingsDefaults,
    isJsonObject(existing) ? existing : {}
  ) satisfies JsonObject;
  const enabled = resolvedSettings.enabled;
  return isBoolean(enabled) ? enabled : true;
};

/** Returns resolved settings for a runtime plugin from in-memory config state. */
export const getRuntimePluginSettings = (cfg: configOptions, pluginId: string): JsonObject => {
  const namespace = getPluginsNamespace(cfg);
  const existing = namespace[pluginId];
  const manifest = findRuntimePluginManifest(pluginId);
  if (!manifest) {
    return isJsonObject(existing) ? existing : {};
  }
  return merge({}, manifest.settingsDefaults, isJsonObject(existing) ? existing : {}) satisfies JsonObject;
};

/** Returns command definitions contributed by currently enabled runtime plugins. */
export const getRuntimePluginCommandDefinitions = (cfg: Pick<configOptions, 'plugins'>): CommandDefinition[] => {
  return runtimePluginManifests.flatMap((manifest) => {
    if (!isRuntimePluginManifestEnabled(cfg, manifest)) {
      return [];
    }
    return manifest.commands.map((command) => cloneValue(command));
  });
};

/** Returns keybinding contributions from currently enabled runtime plugins. */
export const getRuntimePluginKeybindings = (cfg: Pick<configOptions, 'plugins'>) => {
  const accumulator: Record<string, string[]> = {};
  for (const manifest of runtimePluginManifests) {
    if (!isRuntimePluginManifestEnabled(cfg, manifest)) {
      continue;
    }

    Object.keys(manifest.keybindings).forEach((commandId) => {
      accumulator[commandId] = [...manifest.keybindings[commandId]];
    });
  }
  return accumulator;
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
) => ({
  ...runtimeKeybindings,
  ...resolvedKeymaps
});

/**
 * Computes deterministic keybinding conflicts for exact shortcut collisions.
 *
 * The input is expected to already reflect precedence rules, so the helper only
 * reports shortcuts that are still assigned to multiple distinct commands.
 */
export const detectKeybindingConflicts = (keymaps: Record<string, string[]>): readonly KeybindingConflict[] => {
  const commandsByKey = new Map<string, Set<string>>();

  Object.keys(keymaps)
    .toSorted(compareLexical)
    .forEach((commandId) => {
      [...new Set(keymaps[commandId])].toSorted(compareLexical).forEach((keys) => {
        const commands = commandsByKey.get(keys) ?? new Set<string>();
        commands.add(commandId);
        commandsByKey.set(keys, commands);
      });
    });

  return Object.freeze(
    [...commandsByKey.entries()]
      .filter(([, commands]) => commands.size > 1)
      .toSorted(([left], [right]) => compareLexical(left, right))
      .map(([keys, commands]) =>
        Object.freeze({
          keys,
          commands: Object.freeze([...commands].toSorted(compareLexical))
        })
      )
  );
};

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
      const existingSettings = namespace[manifest.id];
      const existing = isJsonObject(existingSettings) ? existingSettings : {};
      const merged = merge({}, manifest.settingsDefaults, existing) satisfies JsonObject;
      if (!isEqual(existing, merged)) {
        namespace[manifest.id] = merged;
        patches.push({pluginId: toPluginId(manifest.id), settings: merged});
      }
    });

    if (patches.length > 0) {
      const patchedContent = applyPluginSettingsPatches(json5Document(rawConfigText), patches);
      if (patchedContent) {
        writeFile(configFilePath, patchedContent, 'utf8');
      } else {
        console.error(
          `Failed to apply runtime plugin settings patch for "${configFilePath}". Skipping write to preserve user formatting.`
        );
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
): JsonObject => {
  const {configFilePath, readFile, writeFile} = resolvePersistenceOptions(options);
  const manifestDefaults = findRuntimePluginManifest(pluginId)?.settingsDefaults ?? {};
  const fallbackSettings = merge({}, manifestDefaults, {enabled}) satisfies JsonObject;

  try {
    const rawConfigText = readFile(configFilePath, 'utf8');
    const rawConfig = parseConfigJson5Strict(json5Document(rawConfigText));
    if (!rawConfig) {
      console.error(`Failed to parse runtime plugin config at "${configFilePath}". Returning fallback settings.`);
      return fallbackSettings;
    }

    const namespace = getOrInitPluginsNamespace(rawConfig);
    const existingSettings = namespace[pluginId];
    const existing = isJsonObject(existingSettings) ? existingSettings : {};
    const merged = merge({}, manifestDefaults, existing, {enabled}) satisfies JsonObject;

    if (!isEqual(existing, merged)) {
      namespace[pluginId] = merged;
      const patchedContent = applyPluginSettingsPatches(json5Document(rawConfigText), [
        {pluginId: toPluginId(pluginId), settings: merged}
      ]);
      if (patchedContent) {
        writeFile(configFilePath, patchedContent, 'utf8');
      } else {
        console.error(
          `Failed to apply runtime plugin enabled patch for "${configFilePath}". Skipping write to preserve user formatting.`
        );
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
