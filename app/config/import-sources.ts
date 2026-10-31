/** @file Loads the default and user configuration layers for the importer. */
/*
 * Start-up is the only phase allowed to create directories, copy schemas, or
 * bootstrap `config.json5`. A reload reads the same layers but writes nothing,
 * so a file the user deleted mid-session stays deleted.
 */
import {existsSync, mkdirpSync, readFileSync, writeFileSync} from 'fs-extra';
import path from 'node:path';

import type {configValidationDiagnostic, rawConfig} from '@shared/types/config';
import {isJsonValue} from '../utils/runtime-guards';
import type {ConfigFallbackCause} from './import-report';
import {ensureSchemaFiles, type SchemaCopyRequest} from './schema-copy';
import {notifyWithPrimaryDiagnostic, type ConfigImportNotify} from './keybindings';
import {replaceLegacyKeymaps} from './import-keybindings';
import {parseKeybindingsText, toRawKeymaps} from './keybindings-codec';
import {parseJson5WithSchemaDiagnostics, safeParseRawConfig, stringifyJson5, type ParseSchema} from './json5-config';

/** Which import the application is performing. */
export type ConfigImportPhase = 'startup' | 'reload';

export type ConfigImportPaths = {
  cfgDir: string;
  cfgPath: string;
  defaultCfg: string;
  /** Directory holding `keybindings.json5`; its schema copy belongs beside it. */
  keybindingsDir: string;
  keybindingsPath: string;
  keybindingsSchemaFile: string;
  keybindingsSchemaPath: string;
  defaultPlatformKeyPath: () => string;
  plugs: {
    base: string;
    local: string;
  };
  schemaFile: string;
  schemaPath: string;
  /** Lower-priority config files the active configuration hides. */
  shadowedConfigPaths: readonly string[];
  /** The Velocetty tree, where new configuration files and schema copies go. */
  velocettyDir: string;
};

type LoadedConfig = {
  config: rawConfig;
  diagnostics: configValidationDiagnostic[];
  /** Present only when the payload is a fallback, naming why it fell back. */
  failure?: ConfigFallbackCause;
  usedFallback: boolean;
};

/** The user and default payloads plus what start-up learned about them. */
export type LoadedSources = {
  readonly userCfg: rawConfig;
  readonly defaultCfg: rawConfig;
  readonly bootstrapped: boolean;
  /** Why the user config fell back; absent when it applied. */
  readonly fallbackCause?: ConfigFallbackCause;
  readonly usedFallback: boolean;
};

/** Bundles the raw text of a config source with the path diagnostics cite. */
type ConfigSource = {
  readonly filePath: string;
  readonly rawContent: string;
};

export type ConfigSourceLoaderDependencies = {
  notify: ConfigImportNotify;
  paths: ConfigImportPaths;
  warn?: typeof console.warn;
};

const defaultRawConfigFallback: rawConfig = {
  plugins: [],
  localPlugins: []
} as const;

/** Creates an isolated copy of a raw config payload for safe mutation. */
const cloneRawConfig = (config: rawConfig): rawConfig => structuredClone(config);

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

/** Emits one warning per non-empty diagnostic list, tagged with its source. */
const reportDiagnostics = (
  warnFn: typeof console.warn,
  context: string,
  sourcePath: string,
  diagnostics: readonly configValidationDiagnostic[]
) => {
  if (diagnostics.length === 0) {
    return;
  }
  warnFn(`[config-import] ${context}`, {source: sourcePath, diagnostics});
};

type ConfigParseOptions<T> = {
  readonly schema: ParseSchema<T>;
  readonly fallback: T;
  readonly itemType: string;
  readonly diagnosticHints: Record<string, {docHint?: string; defaultHint?: string}>;
};

/** Parses one source with the shared JSON5 helper and the caller's schema. */
const parseConfigSource = <T>(source: ConfigSource, options: ConfigParseOptions<T>) =>
  parseJson5WithSchemaDiagnostics({
    raw: source.rawContent,
    source: source.filePath,
    schema: options.schema,
    fallback: options.fallback,
    itemType: options.itemType,
    diagnosticHints: options.diagnosticHints
  });

/** Parses a configuration payload, falling back to `null` on invalid input. */
const parseRawConfig = (source: ConfigSource) =>
  parseConfigSource(source, {
    schema: rawConfigSchema,
    fallback: null,
    itemType: 'config',
    diagnosticHints: rawConfigDiagnosticHints
  });

/** Serializes config using deterministic JSON5 formatting for stable snapshots. */
const stringifyConfig = (config: rawConfig): string => {
  if (!isJsonValue(config)) {
    throw new TypeError('Config values must be JSON-compatible before serialization.');
  }
  return stringifyJson5(config);
};

/** Whether the opt-in start-up trace is enabled for this process. */
const isConfigImportDebugEnabled = (): boolean => process.env.DEBUG_CONFIG_IMPORT === '1';

/**
 * Creates the loader for the bundled defaults and the user config.
 *
 * The loader owns the import's start-up side effects and the cached default
 * payload. It never touches `keybindings.json5`; the caller composes that.
 *
 * @example
 * ```ts
 * const sources = createConfigSourceLoader({notify, paths});
 * const {userCfg, defaultCfg} = sources.load('startup');
 * ```
 */
export const createConfigSourceLoader = (dependencies: ConfigSourceLoaderDependencies) => {
  const {notify: notifyFn} = dependencies;
  const warnFn = dependencies.warn ?? console.warn;
  const pathDeps = dependencies.paths;
  let defaultConfig: rawConfig | undefined;

  /**
   * Copies the bundled JSON schemas into the configuration directories.
   *
   * New copies always go to the Velocetty tree. The legacy Hyper tree is
   * refreshed only when a copy is already there, so upgrading never creates a
   * new file in it.
   */
  const ensureSchemaFile = () => {
    const request: SchemaCopyRequest = {
      notify: notifyFn,
      targets: [
        {directory: pathDeps.velocettyDir, fileName: pathDeps.schemaFile, source: pathDeps.schemaPath},
        {
          directory: pathDeps.keybindingsDir,
          fileName: pathDeps.keybindingsSchemaFile,
          source: pathDeps.keybindingsSchemaPath
        }
      ]
    };
    // Set only when the trees differ, so each target is written once.
    if (pathDeps.cfgDir !== pathDeps.velocettyDir) {
      Object.assign(request, {legacyDirectory: pathDeps.cfgDir});
    }
    ensureSchemaFiles(request);
  };

  /**
   * Bootstraps the user config file from the provided default template.
   *
   * When writing fails, emits contextual error logs and notifies the user.
   */
  const ensureUserConfigFile = (defaultConfigTemplate: rawConfig) => {
    if (existsSync(pathDeps.cfgPath)) {
      return false;
    }

    warnFn(
      `[config-import] User config file missing at "${pathDeps.cfgPath}". Bootstrapping from default config template.`
    );
    try {
      writeFileSync(pathDeps.cfgPath, stringifyConfig(defaultConfigTemplate), 'utf8');
      return true;
    } catch (error) {
      console.error(`[config-import] Failed to write bootstrapped user config at "${pathDeps.cfgPath}".`, error);
      notifyFn("Couldn't create a user config file. Check permissions and available disk space.");
      return false;
    }
  };

  /**
   * Reads the bundled default config, keeping safe defaults on any error.
   *
   * A missing, unreadable, or invalid bundled file is a packaging fault rather
   * than a user fault, so it is reported and the process continues.
   */
  const loadDefaultConfig = (): LoadedConfig => {
    let defaultCfgRaw = '{}';
    try {
      defaultCfgRaw = readFileSync(pathDeps.defaultCfg, 'utf8');
    } catch (error) {
      console.error(`[config-import] Failed to read bundled default config at "${pathDeps.defaultCfg}".`, error);
    }

    const filePath = pathDeps.defaultCfg;
    const parsedDefaultConfigResult = parseRawConfig({filePath, rawContent: defaultCfgRaw});
    if (parsedDefaultConfigResult.usedFallback) {
      reportDiagnostics(warnFn, 'Bundled default config diagnostics.', filePath, parsedDefaultConfigResult.diagnostics);
    }

    if (!parsedDefaultConfigResult.usedFallback && parsedDefaultConfigResult.value !== null) {
      return {
        config: parsedDefaultConfigResult.value,
        diagnostics: parsedDefaultConfigResult.diagnostics,
        usedFallback: false
      };
    }

    console.error(
      `[config-import] Failed to parse bundled default config at "${pathDeps.defaultCfg}". Using safe fallback defaults.`
    );
    notifyWithPrimaryDiagnostic({
      baseMessage: "Couldn't parse the bundled default config. Falling back to safe defaults.",
      diagnostics: parsedDefaultConfigResult.diagnostics,
      notify: notifyFn
    });
    return {
      config: cloneRawConfig(defaultRawConfigFallback),
      diagnostics: parsedDefaultConfigResult.diagnostics,
      usedFallback: true
    };
  };

  /** Reads the shipped per-platform keymap, treating any failure as no defaults. */
  const loadPlatformKeymap = (): Record<string, string | string[]> => {
    const platformKeyPath = pathDeps.defaultPlatformKeyPath();
    const filePath = platformKeyPath;
    let content = '{}';
    try {
      content = readFileSync(platformKeyPath, 'utf8');
    } catch (error) {
      console.error(`[config-import] Failed to read platform keymap at "${platformKeyPath}".`, error);
    }

    const keymapResult = parseKeybindingsText(content, platformKeyPath);
    if (keymapResult.kind === 'invalid') {
      reportDiagnostics(warnFn, 'Platform keymap diagnostics.', filePath, keymapResult.diagnostics);
      return {};
    }
    return toRawKeymaps(keymapResult.keymaps);
  };

  /**
   * Reads the user config, falling back to the supplied defaults.
   *
   * The fallback is deliberate and user-visible: a parse failure keeps the
   * diagnostic list, an unreadable file reports no diagnostics, and both leave
   * `config.json5` untouched so the user can repair it.
   */
  const loadUserConfig = (defaultConfigFallback: rawConfig): LoadedConfig => {
    const filePath = pathDeps.cfgPath;
    try {
      const userCfgResult = parseRawConfig({filePath, rawContent: readFileSync(pathDeps.cfgPath, 'utf8')});
      if (userCfgResult.usedFallback) {
        reportDiagnostics(warnFn, 'User config diagnostics.', filePath, userCfgResult.diagnostics);
      }
      if (!userCfgResult.usedFallback && userCfgResult.value !== null) {
        return {
          config: userCfgResult.value,
          diagnostics: userCfgResult.diagnostics,
          usedFallback: false
        };
      }

      warnFn(
        `[config-import] Using default config fallback after user config parse failure. userPath="${pathDeps.cfgPath}" defaultPath="${pathDeps.defaultCfg}"`
      );
      notifyWithPrimaryDiagnostic({
        baseMessage: "Couldn't parse config file. Using default config instead.",
        diagnostics: userCfgResult.diagnostics,
        notify: notifyFn
      });
      return {
        config: cloneRawConfig(defaultConfigFallback),
        diagnostics: userCfgResult.diagnostics,
        failure: 'parse',
        usedFallback: true
      };
    } catch (error) {
      console.error(`[config-import] Failed to read or parse user config at "${pathDeps.cfgPath}".`, error);
      warnFn(
        `[config-import] Using default config fallback after user config parse failure. userPath="${pathDeps.cfgPath}" defaultPath="${pathDeps.defaultCfg}"`
      );
      notifyWithPrimaryDiagnostic({
        baseMessage: "Couldn't parse config file. Using default config instead.",
        diagnostics: [],
        notify: notifyFn
      });
      return {
        config: cloneRawConfig(defaultConfigFallback),
        diagnostics: [],
        failure: 'read',
        usedFallback: true
      };
    }
  };

  /**
   * Whether this run may create `config.json5`.
   *
   * An active Hyper tree is left alone: creating a Velocetty-style file there
   * would shadow the user's real configuration instead of migrating it.
   */
  const canBootstrapUserConfig = (): boolean => path.resolve(pathDeps.cfgDir) === path.resolve(pathDeps.velocettyDir);

  /** Reads both layers, creating files only during a start-up import. */
  const load = (phase: ConfigImportPhase): LoadedSources => {
    if (phase === 'startup') {
      if (isConfigImportDebugEnabled()) {
        warnFn('[config-import] Initializing config import using app-local JSON5 helpers.');
      }
      // init plugin directories if not present
      mkdirpSync(pathDeps.plugs.base);
      mkdirpSync(pathDeps.plugs.local);
      ensureSchemaFile();
    }

    const {config: defaultCfg} = loadDefaultConfig();
    const bootstrapped = phase === 'startup' && canBootstrapUserConfig() ? ensureUserConfigFile(defaultCfg) : false;
    replaceLegacyKeymaps(defaultCfg, loadPlatformKeymap());
    defaultConfig = defaultCfg;

    const userConfigResult = loadUserConfig(defaultCfg);
    const sources: LoadedSources = {
      bootstrapped,
      defaultCfg,
      usedFallback: userConfigResult.usedFallback,
      userCfg: cloneRawConfig(userConfigResult.config)
    };
    // Added only when the fallback has a known cause, never as `undefined`.
    if (userConfigResult.failure !== undefined) {
      Object.assign(sources, {fallbackCause: userConfigResult.failure});
    }
    return sources;
  };

  /**
   * Returns the cached default config payload.
   *
   * When `_import` has not run yet, this method lazily loads the configuration
   * sources, which performs the same start-up side effects as `load('startup')`.
   * It never starts the keybindings service, so querying defaults cannot seed
   * or re-read `keybindings.json5`.
   */
  const getDefaultConfig = () => {
    defaultConfig ??= load('startup').defaultCfg;
    return defaultConfig;
  };

  return {getDefaultConfig, load};
};
