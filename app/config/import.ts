/** @file Composes config sources, the keybindings service, and migration notices. */
/*
 * The importer is the only place that knows both configuration files. It
 * classifies the legacy keymaps, drives the keybindings service through the
 * right phase, and reports what each file did so the application can decide
 * whether "Configuration updated" is honest.
 */
import type {parsedConfig, rawConfig} from '@shared/types/config';
import {
  classifyLegacyKeymaps,
  createKeybindingsNotices,
  type LegacyKeymapsClassification,
  readLegacyKeymaps,
  replaceLegacyKeymaps
} from './import-keybindings';
import type {ConfigImportReport} from './import-report';
import {
  createConfigSourceLoader,
  type ConfigImportPaths,
  type ConfigImportPhase,
  type ConfigSourceLoaderDependencies
} from './import-sources';
import type {ConfigImportNotify, KeybindingsLoadOutcome} from './keybindings';
import type {LegacyKeymapsSource} from './keybindings-policy';

export {shouldAnnounceReload} from './import-report';
export type {ConfigImportReport} from './import-report';
export type {ConfigImportPaths, ConfigImportPhase} from './import-sources';

/** The keybindings service as the importer sees it. */
export type ConfigImportKeybindings = {
  readonly start: (legacy: LegacyKeymapsSource) => KeybindingsLoadOutcome;
  readonly reload: () => KeybindingsLoadOutcome;
};

type ConfigImportResult = {readonly config: parsedConfig; readonly report: ConfigImportReport};

type ConfigInit = (userCfg: rawConfig, defaultCfg: rawConfig, notify: ConfigImportNotify) => parsedConfig;

type ConfigImportDependencies = {
  _init: ConfigInit;
  keybindings: ConfigImportKeybindings;
  notify: ConfigImportNotify;
  paths: ConfigImportPaths;
  warn?: typeof console.warn;
};

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
 * const {config, report} = importer._import('reload');
 * ```
 */
export const createConfigImportModule = (dependencies: ConfigImportDependencies) => {
  const {_init: initConfig, keybindings, notify: notifyFn} = dependencies;
  const notices = createKeybindingsNotices(notifyFn);
  const sourceOptions: ConfigSourceLoaderDependencies = {notify: notifyFn, paths: dependencies.paths};
  if (dependencies.warn !== undefined) {
    sourceOptions.warn = dependencies.warn;
  }
  const sources = createConfigSourceLoader(sourceOptions);

  /** Shows the migration notices appropriate to what the service did. */
  const reportKeybindings = (outcome: KeybindingsLoadOutcome, classification: LegacyKeymapsClassification) => {
    if (outcome.kind === 'applied' && outcome.origin === 'seeded') {
      notices.announceSeeded();
      return;
    }
    if (classification.legacy.kind === 'parsed-invalid') {
      notices.announceDeferred(classification.diagnostics);
    }
    if (outcome.kind === 'applied' && outcome.origin === 'file' && classification.legacy.kind === 'parsed-keymaps') {
      notices.announceLegacyIgnored();
    }
  };

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
    return {
      config,
      report: {config: loaded.usedFallback ? 'fallback' : 'applied', keybindings: keybindingsStatus(outcome)}
    };
  };

  return {_import, getDefaultConfig: sources.getDefaultConfig};
};
