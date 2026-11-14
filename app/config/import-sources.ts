/** @file Composes the read-only defaults query, the start-up bootstrap, and the user-config read. */
/*
 * This module is the seam the rest of the importer sees. It wires the read-only
 * default query, the start-up bootstrap command, the fault notice policy, and
 * the fault logging together, then adds the user-config read that both phases
 * share. Start-up is the only phase allowed to create directories, copy
 * schemas, or bootstrap `config.json5`, so a reload reads the same layers but
 * writes nothing: a file the user deleted mid-session stays deleted.
 */
import type {rawConfig} from '@shared/types/config';
import {boundedErrorCode} from '../utils/error-code';
import {createImportBootstrap, type ConfigImportPhase} from './import-bootstrap';
import {createImportFaultNotices} from './import-faults';
import {createImportFaultLogging} from './import-fault-logging';
import {
  cloneRawConfig,
  createDefaultConfigQuery,
  defaultFileSystem,
  type ConfigImportFileSystem,
  type ConfigImportPaths,
  type LoadedConfig
} from './import-defaults';
import type {ConfigFallbackCause, ConfigImportNotify} from './import-report';
import {parseRawConfig, reportDiagnostics} from './import-sources-parse';
import {notifyWithPrimaryDiagnostic} from './keybindings-notifier';

export type {ConfigImportPhase} from './import-bootstrap';
export type {ConfigImportFileSystem, ConfigImportPaths, DefaultConfigQuery} from './import-defaults';

/** The user and default payloads plus what start-up learned about them. */
export type LoadedSources = {
  readonly userCfg: rawConfig;
  readonly defaultCfg: rawConfig;
  readonly bootstrapped: boolean;
  /**
   * The text start-up bootstrapped and then applied, when it did both.
   *
   * Only a bootstrapped file needs this: it is the text the watcher baseline
   * may adopt, and only while the file on disk still holds it. A file the user
   * already had is never settled, because start-up did not write it.
   */
  readonly appliedConfigText?: string;
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
  /**
   * Whether the opt-in start-up trace is enabled.
   *
   * Absent means disabled: the composition root supplies the env-reading
   * function, so this module never reads `process.env` itself.
   */
  isDebugEnabled?: () => boolean;
  notify: ConfigImportNotify;
  paths: ConfigImportPaths;
  warn?: typeof console.warn;
  error?: typeof console.error;
};

/** The start-up trace stays off unless the composition root injects the env reader. */
const debugDisabled = (): boolean => false;

/** Records why the user config fell back, when the cause is known. */
const recordFallbackCause = (sources: LoadedSources, result: LoadedConfig): void => {
  // Added only when the fallback has a known cause, never as `undefined`.
  if (result.failure !== undefined) {
    Object.assign(sources, {fallbackCause: result.failure});
  }
};

/** Records the bootstrapped text, so readiness can settle the file it wrote. */
const recordAppliedConfigText = (sources: LoadedSources, bootstrapped: boolean, result: LoadedConfig): void => {
  // Only a file start-up created itself may be settled later, and only while
  // it still holds this text; a file the user already had is not ours.
  if (bootstrapped && result.appliedText !== undefined) {
    Object.assign(sources, {appliedConfigText: result.appliedText});
  }
};

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
  const isDebugEnabled = dependencies.isDebugEnabled ?? debugDisabled;
  const warnFn = dependencies.warn ?? console.warn;
  const errorFn = dependencies.error ?? console.error;
  const pathDeps = dependencies.paths;

  const defaultsQuery = createDefaultConfigQuery({fs: fileSystem, paths: pathDeps});
  const faultLogging = createImportFaultLogging({error: errorFn, warn: warnFn});
  const faultNotices = createImportFaultNotices({notify: notifyFn, reportFaultLog: faultLogging});
  const bootstrap = createImportBootstrap({
    error: errorFn,
    fs: fileSystem,
    isDebugEnabled,
    notify: notifyFn,
    paths: pathDeps,
    warn: warnFn
  });

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
      // Retained beyond the parse: a bootstrapped file's content is what the
      // watcher baseline may adopt, so it must be the text actually applied
      // rather than a later read of whatever the file holds by then.
      const rawContent = fileSystem.readFileSync(pathDeps.cfgPath, 'utf8');
      const userCfgResult = parseRawConfig({filePath, rawContent});
      if (userCfgResult.usedFallback) {
        reportDiagnostics(warnFn, 'User config diagnostics.', userCfgResult.diagnostics);
      }
      if (!userCfgResult.usedFallback && userCfgResult.value !== null) {
        return {
          appliedText: rawContent,
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

  /** Reads both layers, creating files only during a start-up import. */
  const load = (phase: ConfigImportPhase): LoadedSources => {
    if (phase === 'startup') {
      bootstrap.prepareStartupFiles();
    }

    const defaults = defaultsQuery.readDefaults();
    if (phase === 'startup') {
      faultNotices.announceDefaults(defaults);
    }
    const defaultCfg = defaults.config;
    const bootstrapped = bootstrap.bootstrapUserConfig(phase, defaults, defaultCfg);

    const userConfigResult = loadUserConfig(defaultCfg);
    const sources: LoadedSources = {
      bootstrapped,
      defaultCfg: cloneRawConfig(defaultCfg),
      usedFallback: userConfigResult.usedFallback,
      userCfg: cloneRawConfig(userConfigResult.config)
    };
    recordFallbackCause(sources, userConfigResult);
    recordAppliedConfigText(sources, bootstrapped, userConfigResult);
    return sources;
  };

  const getDefaultConfig = defaultsQuery.getDefaultConfig;

  return {getDefaultConfig, load, loadDefaultsOnly: getDefaultConfig};
};
