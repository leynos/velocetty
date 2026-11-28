/** @file The chokidar adapter the debouncing configuration watcher drives. */
/*
 * The adapter is kept apart from the reload runtime: it is the one part of
 * watching that touches the third-party file-system library, so a test can
 * drive the real adapter over a temporary directory without also constructing
 * the import, notification, and metric collaborators a reload needs.
 */
import chokidar from 'chokidar';

import type {WatcherEvent, WatcherHandle} from './watcher';

/**
 * Wraps chokidar in the handle interface the watcher consumes.
 *
 * The watch is non-recursive: the configuration files live directly in their
 * directory, so an event from a nested tree is never a configuration change.
 *
 * @param directories - The directories to watch, non-recursively.
 * @returns The handle the debouncing watcher drives.
 *
 * @example
 * ```ts
 * const handle = createChokidarHandle([path.dirname(configPath)]);
 * ```
 */
export const createChokidarHandle = (directories: readonly string[]): WatcherHandle => {
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
