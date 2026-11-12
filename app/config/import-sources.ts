/** @file Loads the default and user configuration layers for the importer. */
/*
 * Start-up is the only phase allowed to create directories, copy schemas, or
 * bootstrap `config.json5`. A reload reads the same layers but writes nothing,
 * so a file the user deleted mid-session stays deleted. The default-config
 * query is read-only too: it reads the bundled defaults without copying a
 * schema or creating a user file.
 */
import {copySync, existsSync, mkdirpSync, readFileSync, writeFileSync} from 'fs-extra';
import path from 'node:path';

import type {configValidationDiagnostic, rawConfig} from '@shared/types/config';
import {boundedErrorCode} from '../utils/error-code';
import type {ConfigInspection} from './config-tree';
import type {ConfigFallbackCause, ConfigImportNotify} from './import-report';
import {ensureSchemaFiles, type SchemaCopyRequest} from './schema-copy';
import {notifyWithPrimaryDiagnostic} from './keybindings-notifier';
import {replaceLegacyKeymaps} from './import-keybindings';
import type {UserKeymaps} from './keybindings-policy';
import {parseKeybindingsText, toRawKeymaps} from './keybindings-codec';
import {parseRawConfig, reportDiagnostics, stringifyConfig} from './import-sources-parse';

/** Which import the application is performing. */
export type ConfigImportPhase = 'startup' | 'reload';

export type ConfigImportPaths = {
  cfgDir: string;
  cfgPath: string;
  /**
   * Whether the active config path could be inspected.
   *
   * An `inaccessible` path may hold the user's configuration, so start-up must
   * not create a file that would shadow it.
   */
  configInspection: ConfigInspection;
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
  'copySync' | 'existsSync' | 'mkdirpSync' | 'readFileSync' | 'writeFileSync'
>;

type LoadedConfig = {
  config: rawConfig;
  diagnostics: configValidationDiagnostic[];
  /** Present only when the payload is a fallback, naming why it fell back. */
  failure?: ConfigFallbackCause;
  usedFallback: boolean;
};

/** A loaded default payload plus what the platform keymap read learned. */
type LoadedDefaults = LoadedConfig & {
  platformKeymapDiagnostics: readonly configValidationDiagnostic[];
  /** Present only when the platform keymap could not be used. */
  platformKeymapFailure?: ConfigFallbackCause;
  platformKeymapFault: boolean;
};

/** The bundled defaults, with what start-up learned about the shipped files. */
export type DefaultConfigQuery = {
  readonly defaults: rawConfig;
  /** Present when the bundled config file could not be read or parsed. */
  readonly failure?: ConfigFallbackCause;
  /**
   * Whether the shipped platform keymap could not be read or parsed.
   *
   * It is reported separately from `failure` because the two files fail
   * independently: the platform keymap can be missing while the bundled config
   * still applies unchanged.
   */
  readonly platformKeymapFault: boolean;
  /** Present only when the platform keymap could not be used. */
  readonly platformKeymapFailure?: ConfigFallbackCause;
};

/** One shipped-file load: the payload plus whether the file could be used. */
type PlatformKeymapLoad = {
  readonly diagnostics: readonly configValidationDiagnostic[];
  /** Present only when the file could not be used. */
  readonly failure?: ConfigFallbackCause;
  readonly fault: boolean;
  readonly keymaps: UserKeymaps;
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

const defaultFileSystem: ConfigImportFileSystem = {copySync, existsSync, mkdirpSync, readFileSync, writeFileSync};

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
 * The loader owns the import's start-up side effects and the reading of the
 * bundled default payload. It never touches `keybindings.json5`; the caller
 * composes that.
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
  let hasAnnouncedDefaultFaults = false;
  let hasAnnouncedPlatformKeymapFault = false;

  /**
   * Copies the bundled JSON schemas into the configuration directories.
   *
   * New copies always go to the Velocetty tree. The legacy Hyper tree is
   * refreshed only when a copy is already there, so upgrading never creates a
   * new file in it.
   */
  const ensureSchemaFile = () => {
    const request: SchemaCopyRequest = {
      // The copies go through the loader's port, so a test can observe them.
      fs: fileSystem,
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
    const results = ensureSchemaFiles(request);
    for (const result of results) {
      if (result.kind === 'failed') {
        errorFn('[config-import] Failed to copy schema file.', {code: boundedErrorCode(result.error)});
      }
    }
    // One notice covers any number of refused copies: the user's action, not
    // the count, is what matters.
    if (results.some(({kind}) => kind === 'failed')) {
      notifyFn("Couldn't update config schema metadata. Config editor validation may be stale.");
    }
  };

  /**
   * Builds the template written to a missing `config.json5`.
   *
   * The platform keymap stays in the loaded defaults because it seeds the
   * runtime configuration, but it is left out of the bootstrap file: shortcuts
   * belong in `keybindings.json5`, so a copy here would be ignored on every
   * later launch and reported to the user as an ignored setting.
   *
   * @example
   * ```ts
   * createBootstrapTemplate({keymaps: {'window:new': ['ctrl+n']}});
   * // {keymaps: {}}
   * ```
   */
  const createBootstrapTemplate = (defaults: rawConfig): rawConfig => {
    // Clearing the legacy key is the point: a bootstrap file must not carry
    // shortcuts that `keybindings.json5` will supersede on the next launch.
    // oxlint-disable-next-line typescript/no-deprecated -- The template owns this key.
    return {...cloneRawConfig(defaults), keymaps: {}};
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

    warnFn('[config-import] User config file missing. Bootstrapping from default config template.');
    try {
      fileSystem.writeFileSync(pathDeps.cfgPath, stringifyConfig(defaultConfigTemplate), 'utf8');
      return true;
    } catch (error) {
      errorFn('[config-import] Failed to write bootstrapped user config.', {code: boundedErrorCode(error)});
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
    let defaultCfgRaw: string;
    try {
      defaultCfgRaw = fileSystem.readFileSync(pathDeps.defaultCfg, 'utf8');
    } catch {
      // The fault is returned rather than logged: only the start-up command
      // reports it, so the read-only query stays free of sink emissions.
      // A substituted payload is a fallback even though `{}` would parse, so
      // start-up can tell the user the bundled defaults were never read.
      return {
        config: cloneRawConfig(defaultRawConfigFallback),
        diagnostics: [],
        failure: 'read',
        usedFallback: true
      };
    }

    const filePath = pathDeps.defaultCfg;
    const parsedDefaultConfigResult = parseRawConfig({filePath, rawContent: defaultCfgRaw});

    if (!parsedDefaultConfigResult.usedFallback && parsedDefaultConfigResult.value !== null) {
      return {
        config: parsedDefaultConfigResult.value,
        diagnostics: parsedDefaultConfigResult.diagnostics,
        usedFallback: false
      };
    }

    // The fault is returned rather than announced: only the start-up command
    // tells the user, so the read-only query stays free of notifications.
    return {
      config: cloneRawConfig(defaultRawConfigFallback),
      diagnostics: parsedDefaultConfigResult.diagnostics,
      failure: 'parse',
      usedFallback: true
    };
  };

  /**
   * Reads the shipped per-platform keymap, recording whether it was usable.
   *
   * The fault flag travels with the payload so start-up can tell the user that
   * the platform defaults are missing, rather than silently running without
   * them. It is not announced here: only the start-up command notifies.
   */
  const loadPlatformKeymap = (): PlatformKeymapLoad => {
    const platformKeyPath = pathDeps.defaultPlatformKeyPath();
    let content = '{}';
    try {
      content = fileSystem.readFileSync(platformKeyPath, 'utf8');
    } catch {
      // Reported by the start-up command, never by the read that found it.
      return {diagnostics: [], failure: 'read', fault: true, keymaps: {}};
    }

    const keymapResult = parseKeybindingsText(content, platformKeyPath);
    if (keymapResult.kind === 'invalid') {
      return {diagnostics: keymapResult.diagnostics, failure: 'parse', fault: true, keymaps: {}};
    }
    return {diagnostics: [], fault: false, keymaps: toRawKeymaps(keymapResult.keymaps)};
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
        reportDiagnostics(warnFn, 'User config diagnostics.', userCfgResult.diagnostics);
      }
      if (!userCfgResult.usedFallback && userCfgResult.value !== null) {
        return {
          config: userCfgResult.value,
          diagnostics: userCfgResult.diagnostics,
          usedFallback: false
        };
      }

      warnFn('[config-import] Using default config fallback after user config parse failure.');
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
      errorFn('[config-import] Failed to read or parse user config.', {code: boundedErrorCode(error)});
      warnFn('[config-import] Using default config fallback after user config parse failure.');
      notifyWithPrimaryDiagnostic({
        // The catch covers the read as well as anything after it, so the
        // wording must not claim a parse failure the user may not have.
        baseMessage: "Couldn't read or parse config file. Using default config instead.",
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
   * would shadow the user's real configuration instead of migrating it. An
   * unreadable path is left alone for the same reason: the file may already
   * exist, and writing over it would replace a configuration we could not read.
   *
   * A faulted bundled config is left alone too. Its fallback is what the app
   * runs with until the installation is repaired, and writing that degraded
   * template into a new `config.json5` would make it the user's permanent
   * configuration: the file is bootstrapped only once, so a later start-up
   * with a valid bundled config would never replace it. Leaving the file
   * absent lets that repair take effect by creating it from valid defaults.
   */
  const canBootstrapUserConfig = (bundledDefaultsFellBack: boolean): boolean =>
    !bundledDefaultsFellBack &&
    pathDeps.configInspection === 'ok' &&
    path.resolve(pathDeps.cfgDir) === path.resolve(pathDeps.velocettyDir);

  /**
   * Reads the bundled defaults and merges the platform keymap.
   *
   * Each call reads both shipped files afresh rather than reusing an earlier
   * result. A query must not influence what start-up applies: the files are
   * shipped artefacts, and a start-up that reused a query's snapshot could
   * apply a payload the files no longer hold — including a faulted fallback,
   * which it would then persist into `config.json5`. Reading them again costs
   * one small parse and keeps start-up the single authority on what is in
   * effect.
   */
  const readDefaults = (): LoadedDefaults => {
    const loaded = loadDefaultConfig();
    const platform = loadPlatformKeymap();
    replaceLegacyKeymaps(loaded.config, platform.keymaps);
    const defaults: LoadedDefaults = {
      ...loaded,
      platformKeymapDiagnostics: platform.diagnostics,
      platformKeymapFault: platform.fault
    };
    // Added only when the keymap actually failed, never as `undefined`.
    if (platform.failure !== undefined) {
      Object.assign(defaults, {platformKeymapFailure: platform.failure});
    }
    return defaults;
  };

  /**
   * Describes the bundled defaults without writing, logging, or notifying.
   *
   * Both shipped-file faults are part of the result: a caller that needs a
   * usable payload can still read `config`, while one that reports health has
   * the cause instead of guessing. The start-up command turns those causes
   * into log lines and notices, so a query never reaches a sink.
   *
   * @example
   * ```ts
   * const defaults = sources.loadDefaultsOnly();
   * defaults.defaults.keymaps; // the platform bindings, merged into the defaults
   * ```
   */
  const loadDefaultsOnly = (): DefaultConfigQuery => {
    const loaded = readDefaults();
    const result: DefaultConfigQuery = {
      defaults: cloneRawConfig(loaded.config),
      platformKeymapFault: loaded.platformKeymapFault
    };
    // Added only when the bundled file actually fell back, never as `undefined`.
    if (loaded.failure !== undefined) {
      Object.assign(result, {failure: loaded.failure});
    }
    if (loaded.platformKeymapFailure !== undefined) {
      Object.assign(result, {platformKeymapFailure: loaded.platformKeymapFailure});
    }
    return result;
  };

  /**
   * Logs why the bundled default config fell back.
   *
   * Kept out of the read so the query stays silent; start-up calls this once.
   *
   * @example
   * ```ts
   * reportDefaultConfigFault('read', []); // logs the unreadable bundled file
   * ```
   */
  const reportDefaultConfigFault = (
    failure: ConfigFallbackCause | undefined,
    diagnostics: readonly configValidationDiagnostic[]
  ): void => {
    if (failure === 'read') {
      errorFn('[config-import] Failed to read the bundled default config. Using safe fallback defaults.');
      return;
    }
    reportDiagnostics(warnFn, 'Bundled default config diagnostics.', diagnostics);
    errorFn('[config-import] Failed to parse the bundled default config. Using safe fallback defaults.');
  };

  /**
   * Logs why the shipped platform keymap could not be used.
   *
   * @example
   * ```ts
   * reportPlatformKeymapFault('parse', diagnostics); // logs the bad keymap
   * ```
   */
  const reportPlatformKeymapFault = (
    failure: ConfigFallbackCause | undefined,
    diagnostics: readonly configValidationDiagnostic[]
  ): void => {
    if (failure === 'read') {
      errorFn('[config-import] Failed to read the platform keymap. Using no platform defaults.');
      return;
    }
    reportDiagnostics(warnFn, 'Platform keymap diagnostics.', diagnostics);
  };

  /**
   * Tells the user once that the bundled defaults could not be read or parsed.
   *
   * Named separately because a missing file is a packaging fault the user can
   * act on, while a parse fault points at the shipped content.
   *
   * Called from the start-up command, never from the read-only query, so
   * bootstrapping is announced at the moment the application acts on it.
   */
  const announceDefaultFaults = (loaded: LoadedDefaults): void => {
    const {diagnostics, failure, platformKeymapDiagnostics, platformKeymapFailure, platformKeymapFault, usedFallback} =
      loaded;
    if (usedFallback && !hasAnnouncedDefaultFaults) {
      hasAnnouncedDefaultFaults = true;
      reportDefaultConfigFault(failure, diagnostics);
      const fault = failure === 'read' ? 'read' : 'parse';
      notifyWithPrimaryDiagnostic({
        baseMessage: `Couldn't ${fault} the bundled default config. Falling back to safe defaults.`,
        diagnostics,
        notify: notifyFn
      });
    }
    if (platformKeymapFault && !hasAnnouncedPlatformKeymapFault) {
      hasAnnouncedPlatformKeymapFault = true;
      reportPlatformKeymapFault(platformKeymapFailure, platformKeymapDiagnostics);
      notifyFn(
        "Couldn't read the bundled platform keymap. Starting without the platform shortcuts.",
        'Reinstall Velocetty, or check that the application files were not modified.'
      );
    }
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

    const defaults = readDefaults();
    if (phase === 'startup') {
      announceDefaultFaults(defaults);
    }
    const defaultCfg = defaults.config;
    const bootstrapped =
      phase === 'startup' && canBootstrapUserConfig(defaults.usedFallback)
        ? ensureUserConfigFile(createBootstrapTemplate(defaultCfg))
        : false;

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
   * Returns a defensive copy of the bundled defaults and their health.
   *
   * The query is read-only: it reads the bundled defaults and the platform
   * keymap, but never creates a directory, copies a schema, or bootstraps
   * `config.json5`, and it never notifies the user or writes to the warning
   * and error sinks. A fault is logged and announced by the start-up command
   * instead. It also never starts the keybindings service, so querying
   * defaults cannot seed or re-read `keybindings.json5`. Nothing is retained
   * between calls, so a later start-up applies what the files hold then rather
   * than what an earlier query saw.
   *
   * @example
   * ```ts
   * const first = sources.getDefaultConfig();
   * const second = sources.getDefaultConfig();
   * first.defaults === second.defaults; // false, because each caller gets its own copy
   * first.failure; // undefined when the bundled file was read and parsed
   * ```
   */
  const getDefaultConfig = (): DefaultConfigQuery => loadDefaultsOnly();

  return {getDefaultConfig, load, loadDefaultsOnly};
};
