import cp from 'child_process';

import ms from 'ms';
import queue from 'queue';

import {bun, plugs} from '../config/paths';

export const install = (fn: (err: string | null) => void) => {
  const spawnQueue = queue({concurrency: 1});
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
