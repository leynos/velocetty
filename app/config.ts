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
import {createImportRecorder} from './config/config-observability';
import {checkDeprecatedConfig} from './config/config-queries';
import {createConfigSpanRecorder} from './config/config-spans';
import {createConfigWatchRuntime, emitKeymapsMarker, type ConfigWatchRuntime} from './config/config-watch';
import {setCurrentConfig} from './config/current-config';
import {silentMarkerSink, type E2EMarkerSink} from './config/e2e-marker-sink';
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
import {runStartupSession} from './config/startup-session';
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

/**
 * Whether the end-to-end lane started this process.
 *
 * Read here, at the composition root, so a unit that behaves differently under
 * the lane — the RPC server reporting renderer errors — receives the answer as
 * a dependency instead of inspecting the environment itself.
 *
 * @example
 * ```ts
 * RUN_E2E=1 isE2ERun(); // true
 * ```
 */
export const isE2ERun = (): boolean => process.env.RUN_E2E === '1';

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

/** The marker sink this process reports through; the entry point chooses it in `setup`. */
let activeMarkerSink: E2EMarkerSink = silentMarkerSink;

/** The watcher runtime `setup` built, which `subscribe` registers callbacks with. */
let activeWatch: ConfigWatchRuntime | undefined;

/**
 * The marker sink this process reports through.
 *
 * The entry point chooses the sink and hands it to `setup`, which passes it to
 * every unit that reports a marker. A process whose entry point supplied none
 * keeps `silentMarkerSink`, so a shipped build prints no marker at all.
 *
 * @example
 * ```ts
 * const sink = getMarkerSink();
 * sink('[e2e] config-watcher-ready'); // written only under the lane's sink
 * ```
 */
export const getMarkerSink = (): E2EMarkerSink => activeMarkerSink;

/**
 * Registers a callback that runs after every applied reload.
 *
 * Returns an unsubscribe function, so a caller that is torn down does not keep
 * receiving reloads.
 *
 * `setup` builds the watcher runtime, because the marker sink it reports
 * through arrives with it, so a subscription made before start-up has nothing
 * to register with: no reload can run yet.
 *
 * @example
 * ```ts
 * const unsubscribe = subscribe(() => render());
 * unsubscribe(); // the callback no longer runs
 * ```
 */
export const subscribe = (fn: Function): (() => void) => {
  if (activeWatch === undefined) {
    throw new Error('config.subscribe() was called before config.setup().');
  }
  return activeWatch.subscribe(fn);
};

/** What `setup` needs from the entry point that starts this process. */
export type ConfigurationSetupOptions = Readonly<{
  /** Receives every marker the composition root reports; defaults to silence. */
  readonly markerSink?: E2EMarkerSink;
}>;

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
export const setup = ({markerSink = silentMarkerSink}: ConfigurationSetupOptions = {}) => {
  activeMarkerSink = markerSink;
  const configWatch = createConfigWatchRuntime({
    configTree,
    importConfiguration: _import,
    metrics,
    notify,
    recorder,
    markerSink,
    spans,
    watchedFiles
  });
  // The span and the record belong to the start-up session, which takes its
  // sinks as dependencies; this root only supplies the adapters and applies
  // the state the session reports.
  const {imported, startupStamps} = runStartupSession({
    // The ordering lives in the start-up unit: it captures before the import
    // reads and settles only afterwards.
    captureStamps: () => captureWatchedFileStamps(watchedFiles),
    configSource: configTree,
    importConfiguration: () => _import('startup'),
    prepare: () => {
      // The Velocetty tree holds new configuration files, so it must exist
      // before the importer copies schemas or seeds `keybindings.json5`.
      mkdirpSync(velocettyDir);
      // A crashed write can leave a temporary file behind. Start-up is the
      // only phase that may remove it, and the edge owns that cleanup
      // immediately before the seed decision reads the file.
      keybindingsStore.removeStaleTemporaryFiles();
    },
    recorder,
    settleStamps: settleWatchedFileStamps,
    spans
  });
  setCurrentConfig(imported.config);
  const configurationWatcher = configWatch.watch(startupStamps);
  if (configurationWatcher !== undefined) {
    app.on('before-quit', () => {
      // A failed release is already counted; logging its bounded shape keeps a
      // configuration path out of the shutdown log.
      closeWatcherAtShutdown(configurationWatcher, (line, details) => console.warn(line, details));
    });
  }
  checkDeprecatedConfig(notify);
  // The sink the entry point supplied: silent for a shipped build, the lane's
  // stream when the lane's entry point started this process.
  markerSink(`[e2e] keybindings-path ${keybindingsPath}`);
  markerSink(`[e2e] config-path ${cfgPath}`);
  emitKeymapsMarker(imported.report, markerSink);
  activeWatch = configWatch;
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
