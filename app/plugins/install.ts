/**
 * @file Plugin installation module that spawns Bun to install plugin
 * dependencies.
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
 */
export const install = (fn: (err: string | null) => void) => {
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
          maxBuffer: 1024 * 1024
        },
        (err, stdout, stderr) => {
          if (err) {
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
