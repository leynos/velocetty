/** @file Performs the start-up writes: plugin directories, schema copies, and config bootstrap. */
/*
 * Start-up is the only phase allowed to create directories, copy schemas, or
 * bootstrap `config.json5`. This command owns those effects and takes every
 * sink and path as an explicit input, so a reload can compose the loader
 * without any of them happening.
 */
import path from 'node:path';

import type {rawConfig} from '@shared/types/config';
import {boundedErrorCode} from '../utils/error-code';
import type {ConfigImportFileSystem, ConfigImportPaths, LoadedDefaults} from './import-defaults';
import {cloneRawConfig} from './import-defaults';
import type {ConfigImportNotify} from './import-report';
import {stringifyConfig} from './import-sources-parse';
import {ensureSchemaFiles, type SchemaCopyRequest} from './schema-copy';

/** Which import the application is performing. */
export type ConfigImportPhase = 'startup' | 'reload';

/** The explicit inputs a start-up bootstrap needs; none are read from the environment. */
export type ImportBootstrapDependencies = {
  error: typeof console.error;
  fs: ConfigImportFileSystem;
  /** Whether the opt-in start-up trace is enabled; supplied by the composition root. */
  isDebugEnabled: () => boolean;
  notify: ConfigImportNotify;
  paths: ConfigImportPaths;
  warn: typeof console.warn;
};

/** The start-up writes, exposed as two commands so the loader can gate each on phase. */
export type ImportBootstrap = {
  readonly bootstrapUserConfig: (phase: ConfigImportPhase, defaults: LoadedDefaults, defaultCfg: rawConfig) => boolean;
  readonly prepareStartupFiles: () => void;
};

/**
 * Builds the template written to a missing `config.json5`.
 *
 * The platform keymap stays in the loaded defaults because it seeds the
 * runtime configuration, but it is left out of the bootstrap file: shortcuts
 * belong in `keybindings.json5`, so a copy here would be ignored on every
 * later launch and reported to the user as an ignored setting.
 *
 * It captures nothing from the factory, so it is defined once here rather than
 * recreated on every call.
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
 * Creates the start-up bootstrap command.
 *
 * Directories, schema copies, and the `config.json5` template are written here
 * and nowhere else. Every fault is reported through the injected sinks rather
 * than thrown, so a degraded install still starts.
 *
 * @example
 * ```ts
 * const bootstrap = createImportBootstrap({error, fs, isDebugEnabled, notify, paths, warn});
 * bootstrap.prepareStartupFiles();
 * const created = bootstrap.bootstrapUserConfig('startup', defaults, defaults.config);
 * ```
 */
export const createImportBootstrap = (dependencies: ImportBootstrapDependencies): ImportBootstrap => {
  const {
    error: errorFn,
    fs: fileSystem,
    isDebugEnabled,
    notify: notifyFn,
    paths: pathDeps,
    warn: warnFn
  } = dependencies;

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
   * Whether start-up may create `config.json5`, creating it when it may.
   *
   * A reload writes nothing, so the phase is part of the decision rather than
   * something the caller could forget to check.
   */
  const bootstrapUserConfig = (phase: ConfigImportPhase, defaults: LoadedDefaults, defaultCfg: rawConfig): boolean => {
    if (phase !== 'startup') {
      return false;
    }
    if (!canBootstrapUserConfig(defaults.usedFallback)) {
      return false;
    }
    return ensureUserConfigFile(createBootstrapTemplate(defaultCfg));
  };

  /**
   * Creates one plugin directory, reporting a failure without abandoning the
   * rest of start-up.
   *
   * The two plugin trees and the schema copy are independent: a directory the
   * user cannot create degrades plugin loading, but it must not stop the other
   * directory being attempted or leave the schema stale as well.
   */
  const ensurePluginDirectory = (directory: string): void => {
    try {
      fileSystem.mkdirpSync(directory);
    } catch (error) {
      errorFn('[config-import] Failed to create plugin directory.', {code: boundedErrorCode(error)});
    }
  };

  /** Creates the directories and schema a start-up import needs. */
  const prepareStartupFiles = (): void => {
    if (isDebugEnabled()) {
      warnFn('[config-import] Initializing config import using app-local JSON5 helpers.');
    }
    // init plugin directories if not present
    ensurePluginDirectory(pathDeps.plugs.base);
    ensurePluginDirectory(pathDeps.plugs.local);
    ensureSchemaFile();
  };

  return {bootstrapUserConfig, prepareStartupFiles};
};
