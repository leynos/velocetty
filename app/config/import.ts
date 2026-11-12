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
  type ConfigSourceLoaderDependencies
} from './import-sources';
import type {KeybindingsLoadOutcome} from './keybindings-ports';
import type {LegacyKeymapsSource} from './keybindings-policy';

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
   * Whether this start-up created `config.json5`.
   *
   * The caller captures the watcher baseline before the import, so it needs to
   * know which files the import wrote itself; those are the only changes the
   * baseline should not treat as a concurrent edit.
   */
  readonly bootstrapped: boolean;
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
    return {bootstrapped: loaded.bootstrapped, config, keybindings: outcome, report};
  };

  return {_import, getDefaultConfig: sources.getDefaultConfig};
};
