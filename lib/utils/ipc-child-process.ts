import type {ExecFileOptions, ExecOptions} from 'node:child_process';
import {isFunction} from '@shared/types/guards';

import {ipcRenderer} from './ipc';

/** Node's callback shape, deliberately loose because plugins supply it. */
type NodeCallback = (...args: any[]) => void;

// The callback stays optional because this module stands in for Node's
// `child_process`: a plug-in written against the upstream module may call
// `exec(command)` and never pass one. The optional call below is therefore
// load-bearing and must not be "simplified" away.
export function exec(command: string, options: ExecOptions | NodeCallback, callback?: NodeCallback) {
  // Node accepts the callback in the options position. Resolving both into
  // `const`s keeps each binding's type fixed, so the narrowing done by
  // `isFunction` does not have to be undone on reassignment.
  const resolvedOptions: ExecOptions = isFunction(options) ? {} : options;
  const resolvedCallback: NodeCallback | undefined = isFunction(options) ? options : callback;
  ipcRenderer.invoke('child_process.exec', command, resolvedOptions).then(
    ({stdout, stderr}) => resolvedCallback?.(null, stdout, stderr),
    (error) => resolvedCallback?.(error, '', '')
  );
}

export function execSync() {
  console.error('Calling execSync from renderer is disabled');
}

export function execFile(
  file: string,
  args: string[] | NodeCallback | ExecFileOptions,
  options: ExecFileOptions | NodeCallback,
  callback?: NodeCallback
) {
  // Node's `execFile` accepts the callback in either trailing position, so a
  // plug-in may call `execFile(file, callback)` or `execFile(file, args,
  // callback)`. Resolve all three positions once, up front, rather than
  // reassigning the parameters that the checks narrow.
  const resolvedArgs: string[] = Array.isArray(args) ? args : [];
  const optionsCandidate = Array.isArray(args) ? options : args;
  const resolvedOptions: ExecFileOptions = isFunction(optionsCandidate) ? {} : optionsCandidate;
  // A callback in the third position still has to be honoured when the second
  // position was the argument list, so the fallback checks `options` as well.
  let resolvedCallback: NodeCallback | undefined = callback;
  if (isFunction(optionsCandidate)) {
    resolvedCallback = optionsCandidate;
  } else if (isFunction(options)) {
    resolvedCallback = options;
  }
  ipcRenderer.invoke('child_process.execFile', file, resolvedArgs, resolvedOptions).then(
    ({stdout, stderr}) => resolvedCallback?.(null, stdout, stderr),
    (error) => resolvedCallback?.(error, '', '')
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
