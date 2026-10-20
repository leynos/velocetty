import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import path from 'node:path';
import {StringDecoder} from 'node:string_decoder';

import {app} from 'electron';
import defaultShell from 'default-shell';
import type {IPty, IWindowsPtyForkOptions, spawn as npSpawn} from 'node-pty';
import osLocale from 'os-locale';
import shellEnv from 'shell-env';
import {PTY_BATCH_DURATION_MS, PTY_BATCH_MAX_BYTES} from './constants/runtime-telemetry';

import * as config from './config';
import {cliScriptPath} from './config/paths';
import {productName, version} from './package.json';
import {getDecoratedEnv} from './plugins';
import {getFallBackShellConfig} from './utils/shell-fallback';

const createNodePtyError = () =>
  new Error(
    '`node-pty` failed to load. Typically this means that it was built incorrectly. Please check the `readme.md` to more info.'
  );

let spawn: typeof npSpawn;
try {
  spawn = createRequire(path.resolve(app.getAppPath(), 'session.js'))('node-pty').spawn;
} catch {
  throw createNodePtyError();
}

const useConpty = config.getConfig().useConpty;

// Data coming from the pty is sent to the renderer process for further
// vt parsing and rendering. This class batches data to minimize the number of
// IPC calls. It also reduces GC pressure and CPU cost: each chunk is prefixed
// with the window ID which is then stripped on the renderer process and this
// overhead is reduced with batching.
class DataBatcher {
  uid: string;
  onFlush: (data: string) => void;
  decoder: StringDecoder;
  data!: string;
  dataBytes!: number;
  timeout!: NodeJS.Timeout | null;
  constructor(uid: string, onFlush: (data: string) => void) {
    this.uid = uid;
    this.onFlush = onFlush;
    this.decoder = new StringDecoder('utf8');

    this.reset();
  }

  reset() {
    this.data = this.uid;
    this.dataBytes = Buffer.byteLength(this.uid, 'utf8');
    this.timeout = null;
  }

  write(chunk: Buffer | string) {
    const chunkBytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk, 'utf8');
    if (this.dataBytes + chunkBytes >= PTY_BATCH_MAX_BYTES) {
      // We've reached the max batch size. Flush it and start another one
      if (this.timeout) {
        clearTimeout(this.timeout);
        this.timeout = null;
      }
      this.flush();
    }

    this.data += Buffer.isBuffer(chunk) ? this.decoder.write(chunk) : chunk;
    this.dataBytes += chunkBytes;

    if (!this.timeout) {
      this.timeout = setTimeout(() => this.flush(), PTY_BATCH_DURATION_MS);
    }
  }

  flush() {
    // Reset before emitting to allow for potential reentrancy
    const data = this.data;
    this.reset();

    this.onFlush(data);
  }
}

interface SessionOptions {
  uid: string;
  rows?: number;
  cols?: number;
  cwd?: string;
  shell?: string;
  shellArgs?: string[];
  profile: string;
}
// eslint-disable-next-line unicorn/prefer-event-target -- `decorateSessionClass` plugins receive the EventEmitter-compatible session API.
export default class Session extends EventEmitter {
  pty: IPty | null;
  batcher: DataBatcher | null;
  shell: string | null;
  ended: boolean;
  initTimestamp: number;
  profile!: string;
  constructor(options: SessionOptions) {
    super();
    this.pty = null;
    this.batcher = null;
    this.shell = null;
    this.ended = false;
    this.initTimestamp = Date.now();
    this.init(options);
  }

  init({uid, rows, cols, cwd, shell: _shell, shellArgs: _shellArgs, profile}: SessionOptions) {
    this.profile = profile;
    const envFromConfig = config.getProfileConfig(profile).env;
    const defaultShellArgs = ['--login'];

    const shell = _shell || defaultShell;
    const shellArgs = _shellArgs || defaultShellArgs;

    const cleanEnv = process.env.APPIMAGE && process.env.APPDIR ? shellEnv.sync(_shell || defaultShell) : process.env;
    const baseEnv: NodeJS.ProcessEnv = {
      ...cleanEnv,
      LANG: `${osLocale.sync().replace(/-/, '_')}.UTF-8`,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: productName,
      TERM_PROGRAM_VERSION: version,
      ...envFromConfig
    };
    // path to AppImage mount point is added to PATH environment variable automatically
    // which conflicts with the cli
    if (baseEnv.APPIMAGE && baseEnv.APPDIR) {
      baseEnv.PATH = [
        path.dirname(cliScriptPath),
        ...(baseEnv.PATH || '').split(':').filter((val) => !val.startsWith(baseEnv.APPDIR))
      ].join(':');
    }

    // Electron has a default value for process.env.GOOGLE_API_KEY
    // We don't want to leak this to the shell
    // See https://github.com/vercel/hyper/issues/696
    if (baseEnv.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY === baseEnv.GOOGLE_API_KEY) {
      delete baseEnv.GOOGLE_API_KEY;
    }

    const options: IWindowsPtyForkOptions = {
      cols,
      rows,
      cwd,
      env: getDecoratedEnv(baseEnv)
    };

    // if config do not set the useConpty, it will be judged by the node-pty
    if (useConpty !== undefined) {
      options.useConpty = useConpty;
    }

    try {
      this.pty = spawn(shell, shellArgs, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw /is not a function/.test(message) ? createNodePtyError() : error;
    }

    this.batcher = new DataBatcher(uid, (data) => this.emit('data', data));
    this.pty.onData((chunk) => {
      if (this.ended) {
        return;
      }
      this.batcher?.write(chunk);
    });

    this.pty.onExit((e) => {
      if (!this.ended) {
        // fall back to default shell config if the shell exits within 1 sec with non zero exit code
        // this will inform users in case there are errors in the config instead of instant exit
        const runDuration = Date.now() - this.initTimestamp;
        if (e.exitCode > 0 && runDuration < 1000) {
          const fallBackShellConfig = getFallBackShellConfig(shell, shellArgs, defaultShell, defaultShellArgs);
          if (fallBackShellConfig) {
            const msg = `
shell exited in ${runDuration} ms with exit code ${e.exitCode}
please check the shell config: ${JSON.stringify({shell, shellArgs}, undefined, 2)}
using fallback shell config: ${JSON.stringify(fallBackShellConfig, undefined, 2)}
`;
            console.warn(msg);
            this.batcher?.write(msg.replaceAll('\n', '\r\n'));
            this.init({
              uid,
              rows,
              cols,
              cwd,
              shell: fallBackShellConfig.shell,
              shellArgs: fallBackShellConfig.shellArgs,
              profile
            });
          } else {
            const msg = `
shell exited in ${runDuration} ms with exit code ${e.exitCode}
No fallback available, please check the shell config.
`;
            console.warn(msg);
            this.batcher?.write(msg.replaceAll('\n', '\r\n'));
          }
        } else {
          this.ended = true;
          this.emit('exit');
        }
      }
    });

    this.shell = shell;
  }

  exit() {
    this.destroy();
  }

  write(data: string) {
    if (this.pty) {
      this.pty.write(data);
    } else {
      console.warn('Warning: Attempted to write to a session with no pty');
    }
  }

  resize({cols, rows}: {cols: number; rows: number}) {
    if (this.pty) {
      try {
        this.pty.resize(cols, rows);
      } catch (error) {
        console.error(error instanceof Error ? error.stack : error);
      }
    } else {
      console.warn('Warning: Attempted to resize a session with no pty');
    }
  }

  destroy() {
    if (this.pty) {
      try {
        this.pty.kill();
      } catch (error) {
        console.error('exit error', error instanceof Error ? error.stack : error);
      }
    } else {
      console.warn('Warning: Attempted to destroy a session with no pty');
    }
    this.emit('exit');
    this.ended = true;
  }
}
