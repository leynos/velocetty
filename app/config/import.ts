/** @file Composes config sources, the keybindings service, and migration notices. */
/*
 * The importer is the only place that knows both configuration files. It
 * classifies the legacy keymaps, drives the keybindings service through the
 * right phase, and reports what each file did so the application can decide
 * whether "Configuration updated" is honest.
 */
import path from 'node:path';

import type {parsedConfig, rawConfig} from '@shared/types/config';
import {
  classifyLegacyKeymaps,
  createKeybindingsNotices,
  type LegacyKeymapsClassification,
  readLegacyKeymaps,
  replaceLegacyKeymaps
} from './import-keybindings';
import type {ConfigImportNotify, ConfigImportReport} from './import-report';
import {
  createConfigSourceLoader,
  type ConfigImportFileSystem,
  type ConfigImportPaths,
  type ConfigImportPhase,
  type ConfigSourceLoaderDependencies,
  type LoadedSources
} from './import-sources';
import type {KeybindingsLoadOutcome} from './keybindings-ports';
import type {LegacyKeymapsSource} from './keybindings-policy';
import type {WrittenWatchedFile} from './watched-file-stamp';

export {shouldAnnounceReload} from './import-report';
export type {ConfigImportReport} from './import-report';
export type {ConfigImportPaths, ConfigImportPhase} from './import-sources';

/** The keybindings service as the importer sees it. */
export type ConfigImportKeybindings = {
  readonly start: (legacy: LegacyKeymapsSource) => KeybindingsLoadOutcome;
  readonly reload: () => KeybindingsLoadOutcome;
};

export type ConfigImportResult = {
  readonly config: parsedConfig;
  readonly report: ConfigImportReport;
  /**
   * The files this import created, with the exact text it applied.
   *
   * The caller captures the watcher baseline before the import, so a file the
   * import wrote itself looks changed even though the application holds its
   * content. These entries are the only changes the baseline may settle, and
   * only while each file still holds the text listed here. Reload writes
   * nothing, so it always returns an empty list.
   */
  readonly writtenFiles: readonly WrittenWatchedFile[];
  /**
   * What the keybindings service decided, passed through unflattened so the
   * caller can report its `origin`, `basis`, and `cause` without re-deriving
   * them from the coarser report vocabulary.
   */
  readonly keybindings: KeybindingsLoadOutcome;
};

type ConfigInit = (userCfg: rawConfig, defaultCfg: rawConfig, notify: ConfigImportNotify) => parsedConfig;

type ConfigImportDependencies = {
  _init: ConfigInit;
  keybindings: ConfigImportKeybindings;
  notify: ConfigImportNotify;
  paths: ConfigImportPaths;
  fs?: ConfigImportFileSystem;
  isDebugEnabled?: () => boolean;
  warn?: typeof console.warn;
  error?: typeof console.error;
};

/** True when the service created a brand-new file from the legacy keymaps. */
const seededFreshFile = (outcome: KeybindingsLoadOutcome): boolean =>
  outcome.kind === 'applied' && outcome.origin === 'seeded';

/** True when the service kept a `keybindings.json5` the user already had. */
const keptExistingFile = (outcome: KeybindingsLoadOutcome): boolean =>
  outcome.kind === 'applied' && outcome.origin === 'file';

/** True when start-up left the legacy keymaps where they were, pending a fix. */
const deferredMigration = (outcome: KeybindingsLoadOutcome): boolean =>
  outcome.kind === 'kept' && outcome.cause === 'deferred';

/**
 * The bootstrapped `config.json5`, when the import went on to apply it.
 *
 * A write that could not be read back left the application on defaults, so the
 * file's content is not in effect and must not be settled.
 */
const bootstrappedConfigFile = (loaded: LoadedSources, paths: ConfigImportPaths): WrittenWatchedFile | undefined => {
  if (!loaded.bootstrapped) {
    return undefined;
  }
  if (loaded.appliedConfigText === undefined) {
    return undefined;
  }
  return {path: path.resolve(paths.cfgPath), text: loaded.appliedConfigText};
};

/** The seeded `keybindings.json5`, when the service's write landed. */
const seededKeybindingsFile = (
  outcome: KeybindingsLoadOutcome,
  paths: ConfigImportPaths
): WrittenWatchedFile | undefined => {
  if (outcome.kind !== 'applied') {
    return undefined;
  }
  if (outcome.origin !== 'seeded') {
    return undefined;
  }
  if (outcome.writtenText === undefined) {
    return undefined;
  }
  return {path: path.resolve(paths.keybindingsPath), text: outcome.writtenText};
};

/**
 * The files a start-up import wrote, paired with the text it applied.
 *
 * Each entry names a file whose content the application holds, so a watcher
 * baseline may settle it. The service supplies the exact text it wrote.
 *
 * @example
 * ```ts
 * writtenStartupFiles({bootstrapped: true, appliedConfigText: '{}\n', …}, outcome, paths);
 * // [{path: '/home/user/.config/Velocetty/config.json5', text: '{}\n'}]
 * ```
 */
const writtenStartupFiles = (
  loaded: LoadedSources,
  outcome: KeybindingsLoadOutcome,
  paths: ConfigImportPaths
): readonly WrittenWatchedFile[] =>
  [bootstrappedConfigFile(loaded, paths), seededKeybindingsFile(outcome, paths)].filter(
    (file): file is WrittenWatchedFile => file !== undefined
  );

/** Maps a service outcome onto the report vocabulary. */
const keybindingsStatus = (outcome: KeybindingsLoadOutcome): ConfigImportReport['keybindings'] => {
  if (outcome.kind === 'applied') {
    return 'applied';
  }
  return outcome.cause === 'deferred' ? 'unchanged' : 'kept';
};

/**
 * Creates the configuration importer.
 *
 * `_import('startup')` may create directories, copy schemas, and seed
 * `keybindings.json5`; `_import('reload')` writes nothing at all.
 *
 * @example
 * ```ts
 * const importer = createConfigImportModule({_init, keybindings, notify, paths});
 * const {config, keybindings: outcome, report} = importer._import('reload');
 * ```
 */
export const createConfigImportModule = (dependencies: ConfigImportDependencies) => {
  const {_init: initConfig, keybindings, notify: notifyFn} = dependencies;
  // A Hyper tree's active file is `hyper.json`, so the notices must name the
  // file the user actually has rather than assuming `config.json5`.
  const notices = createKeybindingsNotices(notifyFn, path.basename(dependencies.paths.cfgPath));
  const sourceOptions: ConfigSourceLoaderDependencies = {notify: notifyFn, paths: dependencies.paths};
  // Assigned only when supplied: `exactOptionalPropertyTypes` forbids `undefined`.
  if (dependencies.warn !== undefined) {
    sourceOptions.warn = dependencies.warn;
  }
  if (dependencies.error !== undefined) {
    sourceOptions.error = dependencies.error;
  }
  if (dependencies.fs !== undefined) {
    sourceOptions.fs = dependencies.fs;
  }
  if (dependencies.isDebugEnabled !== undefined) {
    sourceOptions.isDebugEnabled = dependencies.isDebugEnabled;
  }
  const sources = createConfigSourceLoader(sourceOptions);

  /** Shows the migration notices appropriate to what the service did. */
  const reportKeybindings = (outcome: KeybindingsLoadOutcome, classification: LegacyKeymapsClassification) => {
    if (seededFreshFile(outcome)) {
      notices.announceSeeded();
      return;
    }
    // "Fix the keymaps to migrate them" is only true when start-up actually
    // deferred the migration. An existing file wins over the legacy keymaps,
    // so telling the user to fix them there would promise a migration that
    // cannot happen.
    if (deferredMigration(outcome) && classification.legacy.kind === 'parsed-invalid') {
      notices.announceDeferred(classification.diagnostics);
    }
    if (keptExistingFile(outcome) && classification.legacy.kind === 'parsed-keymaps') {
      notices.announceLegacyIgnored();
    }
  };

  /**
   * Runs one import and reports what each file did.
   *
   * Start-up may create directories, refresh schemas, seed
   * `keybindings.json5`, and bootstrap `config.json5`. Reload writes nothing.
   * The result carries the parsed `config`, the coarse per-file `report` the
   * composition root uses to decide whether "Configuration updated" is honest,
   * and the unflattened `keybindings` outcome so the caller can report its
   * `origin`, `basis`, and `cause` without re-deriving them.
   */
  const _import = (phase: ConfigImportPhase): ConfigImportResult => {
    const loaded = sources.load(phase);
    if (phase === 'startup') {
      notices.announceShadowed(dependencies.paths.shadowedConfigPaths);
    }
    const classification = classifyLegacyKeymaps({
      bootstrapped: loaded.bootstrapped,
      keymaps: readLegacyKeymaps(loaded.userCfg),
      source: dependencies.paths.cfgPath,
      usedFallback: loaded.usedFallback
    });
    const outcome = phase === 'startup' ? keybindings.start(classification.legacy) : keybindings.reload();
    reportKeybindings(outcome, classification);
    replaceLegacyKeymaps(loaded.userCfg, outcome.keymaps);

    const config = initConfig(loaded.userCfg, loaded.defaultCfg, notifyFn);
    const report: ConfigImportReport = {
      config: loaded.usedFallback ? 'fallback' : 'applied',
      keybindings: keybindingsStatus(outcome)
    };
    // A fallback with no known cause still reports the fallback itself.
    if (loaded.fallbackCause !== undefined) {
      Object.assign(report, {configCause: loaded.fallbackCause});
    }
    // A reload writes nothing, so only a start-up import can have files to settle.
    const writtenFiles = phase === 'startup' ? writtenStartupFiles(loaded, outcome, dependencies.paths) : [];
    return {config, keybindings: outcome, report, writtenFiles};
  };

  return {_import, getDefaultConfig: sources.getDefaultConfig};
};
