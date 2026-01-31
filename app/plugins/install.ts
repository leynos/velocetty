/**
 * @file Handles plugin installation via Bun in a serialised queue.
 *
 * Spawns `bun install` in the plugins directory with production dependencies
 * only, using a concurrency-1 queue to avoid parallel install conflicts.
 */
import cp from 'child_process';

import ms from 'ms';
import queue from 'queue';

import {bun, plugs} from '../config/paths';

/**
 * Installs plugin dependencies using Bun.
 *
 * @example
 * install((err) => {
 *   if (err) {
 *     console.error(err);
 *   }
 * });
 *
 * @param fn - Callback invoked with `null` on success or an error string on
 * failure.
 * @param signal - Optional abort signal to cancel the install process.
 */
export const install = (fn: (err: string | null) => void, signal?: AbortSignal) => {
  const spawnQueue = queue({concurrency: 1});
  /**
   * Queues and executes a Bun command for plugin installation.
   *
   * @example
   * bunFn(['install', '--production', '--silent'], (err) => {
   *   if (err) {
   *     console.error(err);
   *   }
   * });
   *
   * @param args - Arguments to pass to the Bun CLI.
   * @param cb - Callback invoked on completion.
   */
  function bunFn(args: string[], cb: (err: string | null) => void) {
    if (signal?.aborted) {
      cb('Bun install aborted.');
      return;
    }
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      BUN_INSTALL_CACHE_DIR: plugs.cache
    };
    spawnQueue.push((end) => {
      const cmd = [bun].concat(args).join(' ');
      console.log('Launching bun:', cmd);

      cp.execFile(
        bun,
        args,
        {
          cwd: plugs.base,
          env,
          timeout: ms('5m'),
          maxBuffer: 1024 * 1024,
          signal
        },
        (err, stdout, stderr) => {
          if (err) {
            console.error('Bun install failed:', {
              code: err.code,
              signal: err.signal,
              message: err.message
            });
            cb(stderr);
          } else {
            cb(null);
          }
          end?.();
          spawnQueue.start();
        }
      );
    });

    spawnQueue.start();
  }

  bunFn(['install', '--production', '--silent'], (err) => {
    if (err) {
      return fn(err);
    }
    fn(null);
  });
};
