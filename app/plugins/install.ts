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
      ELECTRON_RUN_AS_NODE: 'true'
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

  bunFn(['install', '--no-save', '--production', '--cache-dir', plugs.cache, '--no-progress'], (err) => {
    if (err) {
      return fn(err);
    }
    fn(null);
  });
};
