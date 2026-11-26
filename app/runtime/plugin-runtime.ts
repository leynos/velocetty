/** @file Runtime plugin manifest evaluation and JSON5-backed settings persistence. */
import isEqual from 'lodash/isEqual';
import merge from 'lodash/merge';
import {
  defaultWriterState,
  asConfigFilePath,
  writeConfigEditSync,
  type ConfigFileSystemPort,
  type ConfigWriterDependencies
} from '../config/config-file-writer';
import {createNodeConfigFileSystem} from '../config/node-config-file-port';
import {cfgPath} from '../config/paths';
import type {JsonObject} from '@shared/types/json';
import {describeError} from '../utils/error-code';
import {isBoolean, isJsonObject} from '../utils/runtime-guards';
import {
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
type PersistenceOptions = {
  configFilePath?: string;
  fileSystem?: ConfigFileSystemPort;
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

const resolvePersistenceOptions = (options: PersistenceOptions = {}) => ({
  configFilePath: options.configFilePath ?? getDefaultConfigPath(),
  fileSystem: options.fileSystem ?? createNodeConfigFileSystem()
});

const writerDependenciesFor = (fileSystem: ConfigFileSystemPort): ConfigWriterDependencies => ({
  fileSystem,
  sleep: async () => {
    // The synchronous entry point never waits, so there is no backoff to run.
  },
  log: (message) => {
    console.error(message);
  },
  platform: process.platform,
  processId: () => process.pid,
  ...defaultWriterState
});

/** One plugin settings write, named by the persistence path a refusal reports. */
type PluginSettingsPersistenceRequest = {
  readonly fileSystem: ConfigFileSystemPort;
  readonly configFilePath: string;
  readonly pluginId: string;
  readonly settings: JsonObject;
  /** Names this persistence path in a refusal; it never carries a file path. */
  readonly label: string;
};

/**
 * Persists one plugin's settings through the single config writer.
 *
 * The plugin keys are not part of the core write policy: the plugin runtime
 * owns that namespace, and the writer still re-parses and validates the
 * result, so a malformed document is refused rather than overwritten.
 *
 * A refusal is reported by the writer's own closed reason code rather than the
 * file path, because the path names the user's home directory.
 */
const persistPluginSettings = (request: PluginSettingsPersistenceRequest): void => {
  const outcome = writeConfigEditSync(
    writerDependenciesFor(request.fileSystem),
    request.configFilePath,
    {kind: 'set', path: ['config', 'plugins', request.pluginId], value: request.settings},
    {checkPolicy: () => []}
  );
  if (outcome.kind !== 'written') {
    console.error(`[runtime-plugins] ${request.label} was refused (reason=${outcome.reason}).`);
  }
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
  const {configFilePath, fileSystem} = resolvePersistenceOptions(options);
  try {
    const rawConfigText = fileSystem.readText(asConfigFilePath(configFilePath));
    const rawConfig = parseConfigJson5Strict(json5Document(rawConfigText));
    if (!rawConfig) {
      console.error('[runtime-plugins] Failed to parse the configuration. Returning empty namespace.');
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

    for (const patch of patches) {
      persistPluginSettings({
        fileSystem,
        configFilePath,
        pluginId: patch.pluginId.value,
        settings: patch.settings,
        label: 'The runtime plugin settings patch'
      });
    }

    return namespace;
  } catch (error) {
    console.error(
      '[runtime-plugins] Failed to persist the plugin settings defaults. Returning empty namespace.',
      describeError(error)
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
  const {configFilePath, fileSystem} = resolvePersistenceOptions(options);
  const manifestDefaults = findRuntimePluginManifest(pluginId)?.settingsDefaults ?? {};
  const fallbackSettings = merge({}, manifestDefaults, {enabled}) satisfies JsonObject;

  try {
    const rawConfigText = fileSystem.readText(asConfigFilePath(configFilePath));
    const rawConfig = parseConfigJson5Strict(json5Document(rawConfigText));
    if (!rawConfig) {
      console.error('[runtime-plugins] Failed to parse the configuration. Returning fallback settings.');
      return fallbackSettings;
    }

    const namespace = getOrInitPluginsNamespace(rawConfig);
    const existingSettings = namespace[pluginId];
    const existing = isJsonObject(existingSettings) ? existingSettings : {};
    const merged = merge({}, manifestDefaults, existing, {enabled}) satisfies JsonObject;

    if (!isEqual(existing, merged)) {
      namespace[pluginId] = merged;
      persistPluginSettings({
        fileSystem,
        configFilePath,
        pluginId,
        settings: merged,
        label: 'The runtime plugin enabled patch'
      });
    }

    return merged;
  } catch (error) {
    console.error(
      '[runtime-plugins] Failed to persist the plugin enabled state. Returning fallback settings.',
      describeError(error)
    );
    return fallbackSettings;
  }
};
