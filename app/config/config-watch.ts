/** @file Watches the configuration files and re-runs the import on change. */
/*
 * The watcher owns the subscriber list and the process-wide watcher handle.
 * A runtime is built once per composition root, so a test that loads
 * `app/config.ts` afresh gets its own watcher, while the importer, recorder,
 * span, metric, and notification sinks are passed in. This module therefore
 * never reaches back into the composition root, and the baseline stamps and
 * reload callback arrive as explicit parameters.
 */
import chokidar from 'chokidar';
import path from 'node:path';

import type {ConfigMetrics} from './config-metrics';
import type {ConfigSpanRecorder} from './config-spans';
import type {ConfigWarningNotifier} from './config-queries';
import {checkDeprecatedConfig} from './config-queries';
import type {ImportRecord, ImportRecorder} from './config-observability';
import {getCurrentConfig, setCurrentConfig} from './current-config';
import {formatKeymapsMarker, type E2EKeymapStatus} from './e2e-keymap-probe';
import type {E2EMarkerSink} from './e2e-marker-sink';
import type {ConfigImportResult} from './import';
import {shouldAnnounceReload, type ConfigImportReport, type ConfigSourceKind} from './import-report';
import {createConfigWatcher, type WatcherEvent, type WatcherHandle} from './watcher';
import {createWatchedFileReconciler, type WatchedFileStamps} from './watched-file-stamp';

const CONFIG_DEBOUNCE_MS = 100;

/** Maps the import report onto the keymap status the E2E lane asserts on. */
const keymapStatus = (report: ConfigImportReport): E2EKeymapStatus =>
  report.keybindings === 'applied' ? 'applied' : 'kept';

/**
 * Reports the probe binding the E2E lane asserts on after every reload.
 *
 * @param report - What the import that just finished decided.
 * @param marker - Receives the line when the lane is running.
 *
 * @example
 * ```ts
 * emitKeymapsMarker({config: 'applied', keybindings: 'applied'}, emitE2EMarker);
 * // logs the `[e2e] keymaps` marker for the keymaps now in effect
 * ```
 */
export const emitKeymapsMarker = (report: ConfigImportReport, marker: E2EMarkerSink) => {
  marker(formatKeymapsMarker(keymapStatus(report), getCurrentConfig().keymaps));
};

/** Wraps chokidar in the adapter the watcher debounces over. */
const createChokidarHandle = (directories: readonly string[]): WatcherHandle => {
  const watcher = chokidar.watch([...directories], {depth: 0, ignoreInitial: true});
  /** Subscribes one listener to a single chokidar event name. */
  const on = (event: WatcherEvent, listener: (eventPath: string) => void) => {
    switch (event) {
      case 'add': {
        watcher.on('add', listener);
        break;
      }
      case 'change': {
        watcher.on('change', listener);
        break;
      }
      case 'unlink': {
        watcher.on('unlink', listener);
        break;
      }
    }
  };

  return {
    close: async () => watcher.close(),
    on,
    onError: (listener) => {
      // SAFETY: chokidar's error event emits the error as its only argument.
      watcher.on('error', (error: unknown) => listener(error));
    },
    onReady: (listener) => {
      watcher.on('ready', listener);
    }
  };
};

/** The collaborators the watcher runtime needs from the composition root. */
export type ConfigWatchDependencies = {
  /** Re-runs the configuration import; the watcher never constructs it itself. */
  readonly importConfiguration: (phase: 'reload') => ConfigImportResult;
  readonly recorder: ImportRecorder;
  readonly spans: ConfigSpanRecorder;
  readonly metrics: ConfigMetrics;
  readonly notify: ConfigWarningNotifier;
  /** Receives the E2E markers a reload reports; the composition root chooses it. */
  readonly reportMarker: E2EMarkerSink;
  /** The tree that supplied the active configuration, named in every record. */
  readonly configTree: ConfigSourceKind;
  /** Absolute paths of the files a reload must react to. */
  readonly watchedFiles: readonly string[];
};

/** The reload and watching surface one composition root exposes. */
export type ConfigWatchRuntime = {
  readonly subscribe: (fn: Function) => () => void;
  /**
   * Starts watching once; later calls are no-ops.
   *
   * Returns the handle it created, so the composition root can release it at
   * shutdown, or `undefined` when a watcher was already running.
   */
  readonly watch: (startupStamps: WatchedFileStamps) => {readonly close: () => Promise<void>} | undefined;
};

/**
 * Creates the reload and watching runtime for one composition root.
 *
 * @param dependencies - The importer and the sinks reloads report through.
 * @returns `subscribe` for change callbacks and `watch` to start observing.
 *
 * @example
 * ```ts
 * const runtime = createConfigWatchRuntime({importConfiguration, recorder, spans, metrics, notify, reportMarker, configTree, watchedFiles});
 * const watcher = runtime.watch(startupStamps);
 * ```
 */
export const createConfigWatchRuntime = (dependencies: ConfigWatchDependencies): ConfigWatchRuntime => {
  const {importConfiguration, recorder, spans, metrics, notify, reportMarker, configTree, watchedFiles} = dependencies;
  // The registration, not the callback, is a subscriber's identity. Keying by
  // callback would let a stale cleanup remove a later registration of the same
  // function, which is how a torn-down component could silence its successor.
  const watchers = new Set<Readonly<{notify: Function}>>();
  let configWatcher: {readonly close: () => Promise<void>} | undefined;

  /**
   * Re-imports every source after a watched file changed.
   *
   * One bounded record is emitted per reload attempt, whether it applied, fell
   * back, or kept the previous keymaps and suppressed the user-facing notice.
   * A thrown import produces no per-file outcomes, so it gets its own bounded
   * failure record and counter instead. Only the import is guarded: a
   * subscriber that throws afterwards must not fabricate an import failure.
   */
  const reloadConfiguration = () => {
    const finishSpan = spans.begin('reload');
    let imported: ConfigImportResult;
    try {
      recorder.beginImport({phase: 'reload'});
      imported = importConfiguration('reload');
    } catch (error) {
      finishSpan('thrown');
      recorder.recordImportFailure({cause: 'thrown', phase: 'reload'});
      // The watcher still owns the warning and the decision to keep watching.
      throw error;
    }
    const {config, keybindings: outcome, report} = imported;
    finishSpan(report.config === 'fallback' ? 'fallback' : 'applied');
    setCurrentConfig(config);
    const announced = shouldAnnounceReload(report);
    const record: ImportRecord = {announced, configSource: configTree, outcome, phase: 'reload', report};
    if (report.config === 'fallback') {
      Object.assign(record, {fallbackBasis: 'defaults' as const});
    }
    recorder.recordImport(record);
    if (announced) {
      notify('Configuration updated', 'Configuration reloaded!');
    }
    // The round's audience is fixed before the first callback runs: a
    // subscriber that releases another one, or registers a new one, must not
    // change who is notified while this dispatch is in progress.
    const subscribersToNotify = new Set(watchers);
    for (const {notify: notifySubscriber} of subscribersToNotify) {
      notifySubscriber();
    }
    checkDeprecatedConfig(notify);
    emitKeymapsMarker(report, reportMarker);
  };

  /**
   * Starts the configuration watcher once; later calls are no-ops.
   *
   * @param startupStamps - The file identities captured before the start-up
   *   import, with the files that import wrote settled to what it applied.
   */
  const watch = (startupStamps: WatchedFileStamps) => {
    if (configWatcher !== undefined) {
      return;
    }

    const watchedDirectories = [...new Set(watchedFiles.map((fileName) => path.dirname(fileName)))];
    // Chokidar's initial scan suppresses events for the files it finds, so a
    // save that lands mid-scan would otherwise wait for the next edit. The
    // reconciler compares against the baseline taken before the import read the
    // files, so a save that landed between that read and now is still seen.
    const reconcileOnReady = createWatchedFileReconciler(startupStamps);

    configWatcher = createConfigWatcher<ReturnType<typeof setTimeout>>({
      cancel: (timer) => clearTimeout(timer),
      debounceMs: CONFIG_DEBOUNCE_MS,
      fileNames: watchedFiles,
      handle: createChokidarHandle(watchedDirectories),
      metrics,
      onReady: () => reportMarker('[e2e] config-watcher-ready'),
      /** Re-reads when a file changed, or could not be inspected, during the scan. */
      reconcileOnReady,
      /** Re-imports on a debounced change; the watcher catches whatever it throws. */
      onReload: reloadConfiguration,
      schedule: (callback, delayMs) => setTimeout(callback, delayMs),
      spans
    });

    return configWatcher;
  };

  /**
   * Registers a callback that runs after every applied reload.
   *
   * Returns an unsubscribe function, so a caller that is torn down does not keep
   * receiving reloads. The cleanup removes the registration it was handed and
   * nothing else, so releasing it twice, or releasing it after the same
   * callback has been subscribed again, cannot detach another subscriber.
   *
   * @example
   * ```ts
   * const unsubscribe = subscribe(() => render());
   * unsubscribe(); // the callback no longer runs
   * ```
   */
  const subscribe = (fn: Function) => {
    const registration = {notify: fn};
    watchers.add(registration);
    return () => {
      watchers.delete(registration);
    };
  };

  return {subscribe, watch};
};
