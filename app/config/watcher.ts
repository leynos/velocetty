/** @file Coalesces configuration-directory events into complete reloads. */
/*
 * A burst of filesystem events is one user action: editors write a temporary
 * file and rename it, and a delete can arrive as several notifications. The
 * watcher therefore reloads once, at the end of the burst plus a debounce
 * interval, so a reload never reads a half-written file stream.
 */
import path from 'node:path';

import {describeError} from '../utils/error-code';
import {describeConfigCounters, type ConfigMetrics} from './config-metrics';
import type {ConfigSpanRecorder} from './config-spans';

/** The filesystem events the watcher treats as a configuration change. */
export type WatcherEvent = 'add' | 'change' | 'unlink';

/** The watched-directory adapter the application supplies. */
export type WatcherHandle = {
  readonly on: (event: WatcherEvent, listener: (path: string) => void) => void;
  readonly onReady: (listener: () => void) => void;
  readonly onError: (listener: (error: unknown) => void) => void;
  readonly close: () => Promise<void>;
};

export type ConfigWatcherOptions<TimerHandle> = {
  readonly handle: WatcherHandle;
  /** Absolute paths of the files a reload must react to. */
  readonly fileNames: readonly string[];
  /**
   * Counts watch failures in the shared bounded vocabulary.
   *
   * A lost directory or a failing close is a reliability signal the session
   * should be able to report without parsing log prose, so both are counted
   * here rather than left to the caller's own logging.
   */
  readonly metrics?: ConfigMetrics;
  readonly debounceMs: number;
  readonly schedule: (callback: () => void, delayMs: number) => TimerHandle;
  readonly cancel: (handle: TimerHandle) => void;
  readonly onReload: () => void;
  readonly onReady?: () => void;
  /**
   * Decides whether readiness needs one catch-up reload.
   *
   * A handle that scans the directory before watching it can drop the event
   * for a file that changed after the caller's first read but before the scan
   * finished. The predicate lets the caller compare the files against what
   * that read saw, so an ordinary start-up reconciles nothing.
   */
  readonly reconcileOnReady?: () => boolean;
  /** Records one span per dispatched reload, including a reload that throws. */
  readonly spans?: ConfigSpanRecorder;
  readonly warn?: (message: string, error: unknown) => void;
};

const WATCHED_EVENTS: readonly WatcherEvent[] = ['add', 'change', 'unlink'];

/**
 * Creates the debouncing configuration watcher.
 *
 * Every accepted event restarts one timer, so a burst of any length produces
 * exactly one `onReload` at its last event plus `debounceMs`. A reload that
 * raises further events (including one that throws) starts a new burst rather
 * than being swallowed by the one in flight.
 *
 * @example
 * ```ts
 * const watcher = createConfigWatcher({
 *   handle, fileNames: [cfgPath, keybindingsPath], debounceMs: 100,
 *   schedule: (fn, ms) => setTimeout(fn, ms), cancel: clearTimeout,
 *   onReload: () => reload()
 * });
 * ```
 */
export const createConfigWatcher = <TimerHandle>(options: ConfigWatcherOptions<TimerHandle>) => {
  const warnFn = options.warn ?? console.warn;
  const watchedPaths = new Set(options.fileNames.map((fileName) => path.resolve(fileName)));
  let pendingTimer: TimerHandle | undefined;
  let isClosed = false;

  /**
   * Counts one watch failure and reports it with the current tally.
   *
   * The counters are rendered through the shared fixed-shape describer, so the
   * failure record carries only the closed vocabulary and no path or errno.
   */
  const recordWatchFailure = (message: string, error: unknown): void => {
    options.metrics?.increment('watcherFailures');
    const counters = options.metrics === undefined ? '' : ` ${describeConfigCounters(options.metrics.snapshot())}`;
    // Chokidar's errors can carry a path, so the log gets the bounded shape.
    warnFn(`${message}${counters}`, describeError(error));
  };

  /** Cancels the queued reload, if one is waiting for the debounce to elapse. */
  const cancelPending = () => {
    if (pendingTimer === undefined) {
      return;
    }
    options.cancel(pendingTimer);
    pendingTimer = undefined;
  };

  /** Runs one reload, keeping a thrown failure from silencing later events. */
  const reload = () => {
    pendingTimer = undefined;
    if (isClosed) {
      return;
    }
    const finishSpan = options.spans?.begin('watcher-dispatch');
    try {
      options.onReload();
      finishSpan?.('applied');
    } catch (error) {
      finishSpan?.('thrown');
      // A failed reload must not silence the watcher: the next edit is the
      // user's retry, and it has to be observed like any other event.
      warnFn('[config-watcher] Configuration reload failed.', describeError(error));
    }
  };

  /** Debounces one watched-file event into a single scheduled reload. */
  const onFileEvent = (eventPath: string) => {
    if (isClosed || !watchedPaths.has(path.resolve(eventPath))) {
      return;
    }
    cancelPending();
    pendingTimer = options.schedule(reload, options.debounceMs);
  };

  for (const event of WATCHED_EVENTS) {
    options.handle.on(event, onFileEvent);
  }
  options.handle.onReady(() => {
    if (isClosed) {
      return;
    }
    options.onReady?.();
    if (options.reconcileOnReady?.() === true) {
      // The scan may have swallowed the event for a file that changed after
      // the caller's first read, so read once now that it is complete. Any
      // burst the scan already queued predates that read and is now stale.
      cancelPending();
      reload();
    }
  });
  options.handle.onError((error) => {
    // The watch can lose a directory without the process exiting; log it and
    // keep the handle open so a recreated file is still observed.
    recordWatchFailure('[config-watcher] Configuration watch failed.', error);
  });

  return {
    /** Cancels a pending reload and releases the handle; repeat calls are harmless. */
    close: async () => {
      if (isClosed) {
        return;
      }
      isClosed = true;
      cancelPending();
      try {
        await options.handle.close();
      } catch (error) {
        // The handle is already marked closed, so this cannot retry; count and
        // rethrow so the caller still sees why the release failed.
        recordWatchFailure('[config-watcher] Configuration watch close failed.', error);
        throw error;
      }
    }
  };
};
