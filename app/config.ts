/** @file Composition root: resolves the config tree and wires import, keybindings, and reload. */
/*
 * This module builds the adapters and hands each collaborator its dependencies
 * explicitly. The applied configuration state, the read-only queries, and the
 * file watcher live in `app/config/`, so this file keeps only the wiring and
 * the public entry point. The adapters take filesystem, clock, and
 * notification dependencies as parameters, so the modules below stay testable
 * without Electron.
 */

import {app} from 'electron';

import {mkdirpSync} from 'fs-extra';
import path from 'node:path';

import {createConfigMetrics} from './config/config-metrics';
import {createImportRecorder, type ImportRecord} from './config/config-observability';
import {checkDeprecatedConfig} from './config/config-queries';
import {createConfigSpanRecorder} from './config/config-spans';
import {createConfigWatchRuntime, emitKeymapsMarker} from './config/config-watch';
import {setCurrentConfig} from './config/current-config';
import {emitE2EMarker} from './config/e2e-keymap-probe';
import {createConfigImportModule} from './config/import';
import {_init} from './config/init';
import {createKeybindingsService} from './config/keybindings';
import {keybindingsCodec} from './config/keybindings-codec';
import {createKeybindingsNotifier} from './config/keybindings-notifier';
import {createFileKeybindingsStore} from './config/keybindings-store';
import {
  cfgPath,
  cfgDir,
  configInspection,
  configTree,
  defaultCfg,
  defaultPlatformKeyPath,
  keybindingsPath,
  keybindingsSchemaFile,
  keybindingsSchemaPath,
  plugs,
  schemaFile,
  schemaPath,
  shadowedConfigPaths,
  velocettyDir
} from './config/paths';
import notify from './notify';
import {closeWatcherAtShutdown} from './config/watcher';
import {captureWatchedFileStamps, settleWatchedFileStamps} from './config/watched-file-stamp';

const metrics = createConfigMetrics();

const recorder = createImportRecorder({
  metrics,
  sink: {info: (line) => console.info(line), warn: (line) => console.warn(line)}
});

const spans = createConfigSpanRecorder({
  now: () => performance.now(),
  sink: {info: (line) => console.info(line), warn: (line) => console.warn(line)}
});

// The adapters are built once, at module load, exactly as before the ports
// were split: only the start-up *command* is deferred to `setup()`, so a
// query made earlier still works and still performs no start-up side effects.
const keybindingsStore = createFileKeybindingsStore({
  filePath: keybindingsPath,
  metrics,
  onRetry: recorder.recordRenameRetry,
  spans
});
const keybindingsService = createKeybindingsService({
  codec: keybindingsCodec,
  report: createKeybindingsNotifier(notify),
  store: keybindingsStore
});

/** Whether the opt-in start-up trace is enabled for this process. */
const isConfigImportDebugEnabled = (): boolean => process.env.DEBUG_CONFIG_IMPORT === '1';

const {_import} = createConfigImportModule({
  _init,
  // The environment is read here, at the composition root, so the import
  // modules below take the flag as a dependency and stay testable without it.
  isDebugEnabled: isConfigImportDebugEnabled,
  keybindings: {reload: keybindingsService.reload, start: keybindingsService.start},
  notify,
  paths: {
    cfgDir,
    cfgPath,
    configInspection,
    defaultCfg,
    defaultPlatformKeyPath,
    keybindingsDir: path.dirname(keybindingsPath),
    keybindingsPath,
    keybindingsSchemaFile,
    keybindingsSchemaPath,
    plugs,
    schemaFile,
    schemaPath,
    shadowedConfigPaths,
    velocettyDir
  }
});

/** Imports keybindings text verbatim; the active keymaps change on the next reload. */
export const importKeybindings = keybindingsService.importKeybindings;

/** Reports the stored keybindings text without writing, notifying, or changing state. */
export const exportKeybindings = keybindingsService.exportKeybindings;

/** The files the watcher covers, resolved once because they never change. */
const watchedFiles = [path.resolve(cfgPath), path.resolve(keybindingsPath)];

const configWatch = createConfigWatchRuntime({
  configTree,
  importConfiguration: _import,
  metrics,
  notify,
  recorder,
  reportMarker: emitE2EMarker,
  spans,
  watchedFiles
});

/**
 * Registers a callback that runs after every applied reload.
 *
 * Returns an unsubscribe function, so a caller that is torn down does not keep
 * receiving reloads.
 *
 * @example
 * ```ts
 * const unsubscribe = subscribe(() => render());
 * unsubscribe(); // the callback no longer runs
 * ```
 */
export const subscribe = configWatch.subscribe;

/**
 * Runs the start-up import, then starts watching for configuration changes.
 *
 * Counts the attempt, creates the Velocetty tree, clears a stale temporary
 * keybindings file, and records the import before any watcher can fire, so the
 * first reload sees a complete state. Counting first means a failure during
 * preparation is still reported as a start-up attempt.
 *
 * @example
 * ```ts
 * setup(); // the application is now reading and watching its configuration
 * ```
 */
export const setup = () => {
  const finishSpan = spans.begin('startup');
  let imported: ReturnType<typeof _import>;
  // Captured before the import reads anything: a save that lands between that
  // read and the watcher's baseline must still look like a change, or the app
  // would keep content the file no longer holds and the scan would hide it.
  let startupStamps = captureWatchedFileStamps(watchedFiles);
  try {
    // Count the attempt before any preparation runs: a failure while creating
    // the tree or clearing a stale temporary file is still a start-up attempt,
    // and the failure record below would otherwise describe an uncounted one.
    recorder.beginImport({phase: 'startup'});
    // The Velocetty tree holds new configuration files, so it must exist before
    // the importer copies schemas or seeds `keybindings.json5` into it.
    mkdirpSync(velocettyDir);
    // A crashed write can leave a temporary file behind. Start-up is the only
    // phase that may remove it, and the edge owns that cleanup immediately
    // before the seed decision reads the file.
    keybindingsStore.removeStaleTemporaryFiles();
    imported = _import('startup');
  } catch (error) {
    // A start-up crash is otherwise invisible: no per-file outcome exists, so
    // it needs the same bounded failure record a thrown reload gets.
    finishSpan('thrown');
    recorder.recordImportFailure({cause: 'thrown', phase: 'startup'});
    throw error;
  }
  const {config, keybindings: outcome, report} = imported;
  finishSpan(report.config === 'fallback' ? 'fallback' : 'applied');
  setCurrentConfig(config);
  // Start-up never shows "Configuration updated", so the record states that
  // rather than leaving the field absent.
  const record: ImportRecord = {announced: false, configSource: configTree, outcome, phase: 'startup', report};
  if (report.config === 'fallback') {
    Object.assign(record, {fallbackBasis: 'defaults' as const});
  }
  recorder.recordImport(record);
  // Adopt a written file's identity only while it still holds the text just
  // applied; a concurrent writer that got there first keeps the pre-import
  // identity, so readiness reloads instead of keeping stale content.
  startupStamps = settleWatchedFileStamps(startupStamps, imported.writtenFiles);
  const configurationWatcher = configWatch.watch(startupStamps);
  if (configurationWatcher !== undefined) {
    app.on('before-quit', () => {
      // A failed release is already counted; logging its bounded shape keeps a
      // configuration path out of the shutdown log.
      closeWatcherAtShutdown(configurationWatcher, (line, details) => console.warn(line, details));
    });
  }
  checkDeprecatedConfig(notify);
  emitE2EMarker(`[e2e] keybindings-path ${keybindingsPath}`);
  emitE2EMarker(`[e2e] config-path ${cfgPath}`);
  emitKeymapsMarker(report, emitE2EMarker);
};

export {
  decorateProfileConfig,
  fixConfigDefaults,
  getConfig,
  getConfigDir,
  getDefaultProfile,
  getDeprecatedCSS,
  getKeymaps,
  getPlugins,
  getProfileConfig,
  getProfiles,
  htermConfigTranslate,
  openConfig
} from './config/config-queries';

export {get as getWin, recordState as winRecord, defaults as windowDefaults} from './config/windows';
