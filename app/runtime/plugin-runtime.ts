/** @file Runtime plugin manifest evaluation and JSON5-backed settings persistence. */
import {readFileSync, writeFileSync} from 'node:fs';

import JSON5 from 'json5';
import isEqual from 'lodash/isEqual';
import merge from 'lodash/merge';
import {z} from 'zod';

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

const cloneValue = <T>(value: T): T => structuredClone(value);

const findRuntimePluginManifest = (pluginId: string): RuntimePluginManifest | undefined =>
  runtimePluginManifests.find((manifest) => manifest.id === pluginId);

const getDefaultConfigPath = (): string => {
  // Keep this helper synchronous because callers run in synchronous startup
  // paths and expect a concrete path immediately.
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

const keymapsSchema = z.record(z.string(), z.union([z.string(), z.array(z.string())]));
const rawConfigSchema = z
  .object({
    config: z.record(z.string(), z.unknown()).optional(),
    plugins: z.array(z.string()).optional(),
    localPlugins: z.array(z.string()).optional(),
    keymaps: keymapsSchema.optional()
  })
  .passthrough();

const parseConfigJson5 = (raw: string): rawConfig => {
  try {
    const parsed = JSON5.parse(raw) as unknown;
    const validated = rawConfigSchema.safeParse(parsed);
    if (!validated.success) {
      console.warn('Invalid runtime plugin config shape detected; falling back to empty config.', validated.error);
      return {};
    }
    return validated.data as rawConfig;
  } catch (error) {
    console.warn('Failed to parse runtime plugin JSON5 config; falling back to empty config.', error);
    return {};
  }
};

const stringifyConfigJson5 = (cfg: rawConfig): string => `${JSON5.stringify(cfg, null, 2)}\n`;

/**
 * Ensures `cfg.config` exists.
 *
 * Warning: this helper mutates `cfg` by assigning a default `config` object.
 */
const ensureConfigSection = (cfg: rawConfig): configOptions => {
  if (!isRecord(cfg.config)) {
    cfg.config = {} as configOptions;
  }
  return cfg.config as configOptions;
};

/**
 * Ensures `cfg.plugins` exists.
 *
 * Warning: this helper mutates `cfg` by assigning a default `plugins`
 * namespace object.
 */
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
  try {
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
  configFilePath: string = getDefaultConfigPath(),
  readFile: ReadTextFile = readFileSync,
  writeFile: WriteTextFile = writeFileSync
): RuntimePluginSettings => {
  const manifestDefaults = findRuntimePluginManifest(pluginId)?.settingsDefaults ?? {};
  const fallbackSettings = merge({}, manifestDefaults, {enabled}) as RuntimePluginSettings;

  try {
    const rawConfig = parseConfigJson5(readFile(configFilePath, 'utf8'));
    const configSection = ensureConfigSection(rawConfig);
    const namespace = ensureSettingsNamespace(configSection);
    const existing = asSettingsRecord(namespace[pluginId]);
    const merged = merge({}, manifestDefaults, existing, {enabled}) as RuntimePluginSettings;

    if (!isEqual(existing, merged)) {
      namespace[pluginId] = merged;
      writeFile(configFilePath, stringifyConfigJson5(rawConfig), 'utf8');
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
