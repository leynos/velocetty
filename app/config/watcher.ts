/** @file Coalesces configuration-directory events into complete reloads. */
/*
 * A burst of filesystem events is one user action: editors write a temporary
 * file and rename it, and a delete can arrive as several notifications. The
 * watcher therefore reloads once, at the end of the burst plus a debounce
 * interval, so a reload never reads a half-written file stream.
 */
import path from 'node:path';

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
  readonly debounceMs: number;
  readonly schedule: (callback: () => void, delayMs: number) => TimerHandle;
  readonly cancel: (handle: TimerHandle) => void;
  readonly onReload: () => void;
  readonly onReady?: () => void;
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

  const cancelPending = () => {
    if (pendingTimer === undefined) {
      return;
    }
    options.cancel(pendingTimer);
    pendingTimer = undefined;
  };

  const reload = () => {
    pendingTimer = undefined;
    if (isClosed) {
      return;
    }
    try {
      options.onReload();
    } catch (error) {
      // A failed reload must not silence the watcher: the next edit is the
      // user's retry, and it has to be observed like any other event.
      warnFn('[config-watcher] Configuration reload failed.', error);
    }
  };

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
    if (!isClosed) {
      options.onReady?.();
    }
  });
  options.handle.onError((error) => {
    // The watch can lose a directory without the process exiting; log it and
    // keep the handle open so a recreated file is still observed.
    warnFn('[config-watcher] Configuration watch failed.', error);
  });

  return {
    close: async () => {
      if (isClosed) {
        return;
      }
      isClosed = true;
      cancelPending();
      await options.handle.close();
    }
  };
};
