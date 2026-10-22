import type {ExecFileOptions, ExecOptions} from 'node:child_process';
import {isFunction} from '@shared/types/guards';

import {ipcRenderer} from './ipc';

// The callback stays optional because this module stands in for Node's
// `child_process`: a plug-in written against the upstream module may call
// `exec(command)` and never pass one. The optional call below is therefore
// load-bearing and must not be "simplified" away.
export function exec(command: string, options: ExecOptions, callback?: (..._args: any) => void) {
  if (isFunction(options)) {
    callback = options;
    options = {};
  }
  ipcRenderer.invoke('child_process.exec', command, options).then(
    ({stdout, stderr}) => callback?.(null, stdout, stderr),
    (error) => callback?.(error, '', '')
  );
}

export function execSync() {
  console.error('Calling execSync from renderer is disabled');
}

export function execFile(file: string, args: string[], options: ExecFileOptions, callback?: (..._args: any) => void) {
  if (isFunction(options)) {
    callback = options;
    options = {};
  }
  if (isFunction(args)) {
    callback = args;
    args = [];
    options = {};
  }
  ipcRenderer.invoke('child_process.execFile', file, args, options).then(
    ({stdout, stderr}) => callback?.(null, stdout, stderr),
    (error) => callback?.(error, '', '')
  );
}

export function execFileSync() {
  console.error('Calling execFileSync from renderer is disabled');
}

export function spawn() {
  console.error('Calling spawn from renderer is disabled');
}

export function spawnSync() {
  console.error('Calling spawnSync from renderer is disabled');
}

export function fork() {
  console.error('Calling fork from renderer is disabled');
}

const IPCChildProcess = {
  exec,
  execSync,
  execFile,
  execFileSync,
  spawn,
  spawnSync,
  fork
};

export default IPCChildProcess;
