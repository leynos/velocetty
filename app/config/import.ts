/** @file Imports and normalizes user and default configuration files. */
import {resolve} from 'node:path';

import {copySync, existsSync, mkdirpSync, readFileSync, writeFileSync} from 'fs-extra';
import {z} from 'zod';

import type {configValidationDiagnostic, rawConfig} from '@shared/types/config';
import notify from '../notify';
import {parseJson5WithSchemaDiagnostics, safeParseRawConfig, stringifyJson5, type ParseSchema} from './json5-config';

import {_init} from './init';
import {cfgDir, cfgPath, defaultCfg, defaultPlatformKeyPath, plugs, schemaFile, schemaPath} from './paths';

type LoadedConfig = {
  config: rawConfig;
  diagnostics: configValidationDiagnostic[];
};

/** A file path used to identify a config artefact in diagnostics. */
type ConfigFilePath = {
  readonly path: string;
};

/** Bundles the raw text and originating file path of a config source. */
type ConfigSource = {
  readonly filePath: ConfigFilePath;
  readonly rawContent: string;
};

let defaultConfig: rawConfig;
const defaultRawConfigFallback: rawConfig = {
  plugins: [],
  localPlugins: [],
  keymaps: {}
} as const;

/** Creates an isolated copy of a raw config payload for safe mutation. */
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

const rawConfigDiagnosticHints = {
  '/': {
    docHint: 'Top-level config payload object.',
    defaultHint: '{}'
  },
  '/config': {
    docHint: 'Root terminal configuration object.',
    defaultHint: '{}'
  },
  '/plugins': {
    docHint: 'List of plugins to fetch and install from npm.',
    defaultHint: '[]'
  },
  '/localPlugins': {
    docHint: 'List of local plugin directories to load in development.',
    defaultHint: '[]'
  },
  '/keymaps': {
    docHint: 'Command keymap overrides as strings or string arrays.',
    defaultHint: '{}'
  }
} as const;

const keymapDiagnosticHints = {
  '/': {
    docHint: 'Keymap entries map command ids to keybinding strings or arrays.',
    defaultHint: '{}'
  }
} as const;

const reportDiagnostics = (context: string, source: ConfigFilePath, diagnostics: configValidationDiagnostic[]) => {
  if (diagnostics.length === 0) {
    return;
  }
  console.warn(`[config-import] ${context}`, {source: source.path, diagnostics});
};

const notifyWithPrimaryDiagnostic = (baseMessage: string, diagnostics: configValidationDiagnostic[]) => {
  const primaryDiagnostic = diagnostics[0];
  if (!primaryDiagnostic) {
    notify(baseMessage);
    return;
  }

  const docHint = primaryDiagnostic.docHint ? ` Hint: ${primaryDiagnostic.docHint}.` : '';
  const defaultHint = primaryDiagnostic.defaultHint ? ` Default: ${primaryDiagnostic.defaultHint}.` : '';
  notify(
    `${baseMessage} ${primaryDiagnostic.path}: ${primaryDiagnostic.message} Suggested fix: ${primaryDiagnostic.suggestedFix}.${docHint}${defaultHint}`
  );
};

/**
 * Parses JSON5 config text into a validated raw config payload.
 *
 * Returns parsed payload plus structured diagnostics when fallback is used.
 */
type ConfigParseOptions<T> = {
  readonly schema: ParseSchema<T>;
  readonly fallback: T;
  readonly itemType: string;
  readonly diagnosticHints: Record<string, {docHint?: string; defaultHint?: string}>;
};

const parseConfigSource = <T>(source: ConfigSource, options: ConfigParseOptions<T>) =>
  parseJson5WithSchemaDiagnostics({
    raw: source.rawContent,
    source: source.filePath.path,
    schema: options.schema,
    fallback: options.fallback,
    itemType: options.itemType,
    diagnosticHints: options.diagnosticHints
  });

const parseRawConfig = (source: ConfigSource) =>
  parseConfigSource(source, {
    schema: rawConfigSchema,
    fallback: null,
    itemType: 'config',
    diagnosticHints: rawConfigDiagnosticHints
  });

/**
 * Parses JSON5 keymap text and validates that each entry is a string or string array.
 *
 * Returns parsed keymaps plus diagnostics when fallback is used.
 */
const parseKeymapConfig = (source: ConfigSource) =>
  parseConfigSource(source, {
    schema: keymapSchema,
    fallback: {},
    itemType: 'keymap',
    diagnosticHints: keymapDiagnosticHints
  });

/** Serializes config using deterministic JSON5 formatting for stable snapshots. */
const stringifyConfig = (config: rawConfig): string => stringifyJson5(config);

/**
 * Copies the bundled JSON schema into the user config directory.
 *
 * Logs and notifies when copying fails so schema-backed editor metadata issues
 * are visible to users.
 */
const ensureSchemaFile = () => {
  const destinationPath = resolve(cfgDir, schemaFile);
  try {
    copySync(schemaPath, destinationPath, {overwrite: true});
  } catch (err) {
    console.error(`[config-import] Failed to copy schema file from "${schemaPath}" to "${destinationPath}".`, err);
    notify("Couldn't update config schema metadata. Config editor validation may be stale.");
  }
};

/**
 * Bootstraps the user config file from the provided default template.
 *
 * When writing fails, emits contextual error logs and notifies the user.
 */
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

const isConfigImportDebugEnabled = () => process.env.DEBUG_CONFIG_IMPORT === '1';

const loadDefaultConfig = (): LoadedConfig => {
  let defaultCfgRaw = '{}';
  try {
    defaultCfgRaw = readFileSync(defaultCfg, 'utf8');
  } catch (err) {
    console.error(`[config-import] Failed to read bundled default config at "${defaultCfg}".`, err);
  }

  const filePath: ConfigFilePath = {path: defaultCfg};
  const parsedDefaultConfigResult = parseRawConfig({filePath, rawContent: defaultCfgRaw});
  if (parsedDefaultConfigResult.usedFallback) {
    reportDiagnostics('Bundled default config diagnostics.', filePath, parsedDefaultConfigResult.diagnostics);
  }

  if (!parsedDefaultConfigResult.usedFallback && parsedDefaultConfigResult.value !== null) {
    return {
      config: parsedDefaultConfigResult.value,
      diagnostics: parsedDefaultConfigResult.diagnostics
    };
  }

  console.error(
    `[config-import] Failed to parse bundled default config at "${defaultCfg}". Using safe fallback defaults.`
  );
  notifyWithPrimaryDiagnostic(
    "Couldn't parse the bundled default config. Falling back to safe defaults.",
    parsedDefaultConfigResult.diagnostics
  );
  return {
    config: cloneRawConfig(defaultRawConfigFallback),
    diagnostics: parsedDefaultConfigResult.diagnostics
  };
};

const loadPlatformKeymap = (): Record<string, string | string[]> => {
  const platformKeyPath = defaultPlatformKeyPath();
  const filePath: ConfigFilePath = {path: platformKeyPath};
  let content = '{}';
  try {
    content = readFileSync(platformKeyPath, 'utf8');
  } catch (err) {
    console.error(`[config-import] Failed to read platform keymap at "${platformKeyPath}".`, err);
  }

  const keymapResult = parseKeymapConfig({filePath, rawContent: content});
  if (keymapResult.usedFallback) {
    reportDiagnostics('Platform keymap diagnostics.', filePath, keymapResult.diagnostics);
  }
  return keymapResult.value;
};

const loadUserConfig = (defaultConfigFallback: rawConfig): LoadedConfig => {
  const filePath: ConfigFilePath = {path: cfgPath};
  try {
    const userCfgResult = parseRawConfig({filePath, rawContent: readFileSync(cfgPath, 'utf8')});
    if (userCfgResult.usedFallback) {
      reportDiagnostics('User config diagnostics.', filePath, userCfgResult.diagnostics);
    }
    if (!userCfgResult.usedFallback && userCfgResult.value !== null) {
      return {
        config: userCfgResult.value,
        diagnostics: userCfgResult.diagnostics
      };
    }

    console.warn(
      `[config-import] Using default config fallback after user config parse failure. userPath="${cfgPath}" defaultPath="${defaultCfg}"`
    );
    notifyWithPrimaryDiagnostic("Couldn't parse config file. Using default config instead.", userCfgResult.diagnostics);
    return {
      config: cloneRawConfig(defaultConfigFallback),
      diagnostics: userCfgResult.diagnostics
    };
  } catch (err) {
    console.error(`[config-import] Failed to read or parse user config at "${cfgPath}".`, err);
    console.warn(
      `[config-import] Using default config fallback after user config parse failure. userPath="${cfgPath}" defaultPath="${defaultCfg}"`
    );
    notifyWithPrimaryDiagnostic("Couldn't parse config file. Using default config instead.", []);
    return {
      config: cloneRawConfig(defaultConfigFallback),
      diagnostics: []
    };
  }
};

const _importConf = () => {
  if (isConfigImportDebugEnabled()) {
    console.warn('[config-import] Initializing config import using app-local JSON5 helpers.');
  }
  // init plugin directories if not present
  mkdirpSync(plugs.base);
  mkdirpSync(plugs.local);
  ensureSchemaFile();

  const {config: _defaultCfg} = loadDefaultConfig();

  ensureUserConfigFile(_defaultCfg);

  _defaultCfg.keymaps = loadPlatformKeymap();

  const {config: userCfg} = loadUserConfig(_defaultCfg);

  return {userCfg, defaultCfg: _defaultCfg};
};

export const _import = () => {
  const imported = _importConf();
  defaultConfig = imported.defaultCfg;
  const result = _init(imported.userCfg, imported.defaultCfg);
  return result;
};

/**
 * Returns the cached default config payload.
 *
 * When `_import` has not run yet, this method lazily calls `_importConf` to
 * initialize `defaultConfig`. That initialization performs filesystem side
 * effects:
 * - plugin directory creation (`mkdirpSync`)
 * - schema copy into the config directory (`ensureSchemaFile`)
 * - user config bootstrapping when missing (`ensureUserConfigFile`)
 */
export const getDefaultConfig = () => {
  if (!defaultConfig) {
    defaultConfig = _importConf().defaultCfg;
  }
  return defaultConfig;
};
