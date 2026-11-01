/** @file Loads the default and user configuration layers for the importer. */
/*
 * Start-up is the only phase allowed to create directories, copy schemas, or
 * bootstrap `config.json5`. A reload reads the same layers but writes nothing,
 * so a file the user deleted mid-session stays deleted. The default-config
 * query is read-only too: it reads and caches the bundled defaults without
 * copying a schema or creating a user file.
 */
import {existsSync, mkdirpSync, readFileSync, writeFileSync} from 'fs-extra';
import path from 'node:path';

import type {configValidationDiagnostic, rawConfig} from '@shared/types/config';
import type {ConfigFallbackCause, ConfigImportNotify} from './import-report';
import {ensureSchemaFiles, type SchemaCopyRequest} from './schema-copy';
import {notifyWithPrimaryDiagnostic} from './keybindings-notifier';
import {replaceLegacyKeymaps} from './import-keybindings';
import {parseKeybindingsText, toRawKeymaps} from './keybindings-codec';
import {parseRawConfig, reportDiagnostics, stringifyConfig} from './import-sources-parse';

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

/** The filesystem subset the loader uses; injected so a query can be proved read-only. */
export type ConfigImportFileSystem = Pick<
  typeof import('fs-extra'),
  'existsSync' | 'mkdirpSync' | 'readFileSync' | 'writeFileSync'
>;

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

export type ConfigSourceLoaderDependencies = {
  /**
   * The filesystem functions the loader may call. Injected so a test can show
   * that the default query writes nothing.
   */
  fs?: ConfigImportFileSystem;
  /** Whether the opt-in start-up trace is enabled; injected for the same reason. */
  isDebugEnabled?: () => boolean;
  notify: ConfigImportNotify;
  paths: ConfigImportPaths;
  warn?: typeof console.warn;
  error?: typeof console.error;
};

const defaultFileSystem: ConfigImportFileSystem = {existsSync, mkdirpSync, readFileSync, writeFileSync};

const defaultRawConfigFallback: rawConfig = {
  plugins: [],
  localPlugins: []
} as const;

/** Creates an isolated copy of a raw config payload for safe mutation. */
const cloneRawConfig = (config: rawConfig): rawConfig => structuredClone(config);

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
  const fileSystem = dependencies.fs ?? defaultFileSystem;
  const isDebugEnabled = dependencies.isDebugEnabled ?? isConfigImportDebugEnabled;
  const warnFn = dependencies.warn ?? console.warn;
  const errorFn = dependencies.error ?? console.error;
  const pathDeps = dependencies.paths;
  let defaultsCache: rawConfig | undefined;

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
    if (fileSystem.existsSync(pathDeps.cfgPath)) {
      return false;
    }

    warnFn(
      `[config-import] User config file missing at "${pathDeps.cfgPath}". Bootstrapping from default config template.`
    );
    try {
      fileSystem.writeFileSync(pathDeps.cfgPath, stringifyConfig(defaultConfigTemplate), 'utf8');
      return true;
    } catch (error) {
      errorFn(`[config-import] Failed to write bootstrapped user config at "${pathDeps.cfgPath}".`, error);
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
      defaultCfgRaw = fileSystem.readFileSync(pathDeps.defaultCfg, 'utf8');
    } catch (error) {
      errorFn(`[config-import] Failed to read bundled default config at "${pathDeps.defaultCfg}".`, error);
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

    errorFn(
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
      content = fileSystem.readFileSync(platformKeyPath, 'utf8');
    } catch (error) {
      errorFn(`[config-import] Failed to read platform keymap at "${platformKeyPath}".`, error);
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
      const userCfgResult = parseRawConfig({
        filePath,
        rawContent: fileSystem.readFileSync(pathDeps.cfgPath, 'utf8')
      });
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
      errorFn(`[config-import] Failed to read or parse user config at "${pathDeps.cfgPath}".`, error);
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

  /**
   * Reads the bundled defaults and merges the platform keymap, with no writes.
   *
   * The result is cached for the process, so a later start-up import reuses the
   * payload it already read rather than touching the bundled files again.
   *
   * @example
   * ```ts
   * const defaults = sources.loadDefaultsOnly();
   * defaults.keymaps; // the platform bindings, merged into the bundled defaults
   * ```
   */
  const loadDefaultsOnly = (): rawConfig => {
    if (defaultsCache === undefined) {
      const {config: defaultCfg} = loadDefaultConfig();
      replaceLegacyKeymaps(defaultCfg, loadPlatformKeymap());
      defaultsCache = defaultCfg;
    }
    return defaultsCache;
  };

  /** Reads both layers, creating files only during a start-up import. */
  const load = (phase: ConfigImportPhase): LoadedSources => {
    if (phase === 'startup') {
      if (isDebugEnabled()) {
        warnFn('[config-import] Initializing config import using app-local JSON5 helpers.');
      }
      // init plugin directories if not present
      fileSystem.mkdirpSync(pathDeps.plugs.base);
      fileSystem.mkdirpSync(pathDeps.plugs.local);
      ensureSchemaFile();
    }

    const defaultCfg = loadDefaultsOnly();
    const bootstrapped = phase === 'startup' && canBootstrapUserConfig() ? ensureUserConfigFile(defaultCfg) : false;

    const userConfigResult = loadUserConfig(defaultCfg);
    const sources: LoadedSources = {
      bootstrapped,
      defaultCfg: cloneRawConfig(defaultCfg),
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
   * Returns a defensive copy of the bundled defaults.
   *
   * The query is read-only: it reads and caches the bundled defaults and the
   * platform keymap, but never creates a directory, copies a schema, or
   * bootstraps `config.json5`. It also never starts the keybindings service,
   * so querying defaults cannot seed or re-read `keybindings.json5`.
   *
   * @example
   * ```ts
   * const first = sources.getDefaultConfig();
   * const second = sources.getDefaultConfig();
   * first === second; // false, because each caller gets its own copy
   * ```
   */
  const getDefaultConfig = (): rawConfig => cloneRawConfig(loadDefaultsOnly());

  return {getDefaultConfig, load, loadDefaultsOnly};
};
