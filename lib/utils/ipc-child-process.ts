import type {ExecFileOptions, ExecOptions} from 'node:child_process';

import {ipcRenderer} from './ipc';

/** Runs a shell command in the main process via IPC and reports the result to `callback`. */
export function exec(command: string, options: ExecOptions, callback: (..._args: any) => void) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  ipcRenderer.invoke('child_process.exec', command, options).then(
    ({stdout, stderr}) => callback?.(null, stdout, stderr),
    (error) => callback?.(error, '', '')
  );
}

/** Disabled in the renderer: synchronous child process execution must happen in the main process. */
export function execSync() {
  console.error('Calling execSync from renderer is disabled');
}

/** Runs an executable in the main process via IPC and reports the result to `callback`. */
export function execFile(file: string, args: string[], options: ExecFileOptions, callback: (..._args: any) => void) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (typeof args === 'function') {
    callback = args;
    args = [];
    options = {};
  }
  ipcRenderer.invoke('child_process.execFile', file, args, options).then(
    ({stdout, stderr}) => callback?.(null, stdout, stderr),
    (error) => callback?.(error, '', '')
  );
}

/** Disabled in the renderer: synchronous file execution must happen in the main process. */
export function execFileSync() {
  console.error('Calling execFileSync from renderer is disabled');
}

/** Disabled in the renderer: spawning processes must happen in the main process. */
export function spawn() {
  console.error('Calling spawn from renderer is disabled');
}

/** Disabled in the renderer: synchronous process spawning must happen in the main process. */
export function spawnSync() {
  console.error('Calling spawnSync from renderer is disabled');
}

/** Disabled in the renderer: forking processes must happen in the main process. */
export function fork() {
  console.error('Calling fork from renderer is disabled');
}

/** Renderer-side child-process facade backed by IPC to the main process. */
const IPCChildProcess = {
  /** Runs a shell command in the main process via IPC and reports the result to `callback`. */
  exec,
  /** Disabled in the renderer: synchronous child process execution must happen in the main process. */
  execSync,
  /** Runs an executable in the main process via IPC and reports the result to `callback`. */
  execFile,
  /** Disabled in the renderer: synchronous file execution must happen in the main process. */
  execFileSync,
  /** Disabled in the renderer: spawning processes must happen in the main process. */
  spawn,
  /** Disabled in the renderer: synchronous process spawning must happen in the main process. */
  spawnSync,
  /** Disabled in the renderer: forking processes must happen in the main process. */
  fork
};

/** `child_process`-like API forwarding execution requests to the main process over IPC. */
/** Renderer-side child-process facade backed by IPC to the main process. */
export default IPCChildProcess;
