/** @file Shared workspaces and filesystem faults for the keybindings store tests. */
/*
 * The store tests split into behaviour and fault-injection suites. Both need
 * the same temporary workspaces and genuine `node:fs` surface, so the setup
 * lives here rather than being duplicated or hidden in a test file.
 */
import {expect, mock} from 'bun:test';

import * as fs from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

import type {KeybindingsStore} from '../../app/config/keybindings-ports';
import type {KeybindingsFileSystem, RenameRetryEvent} from '../../app/config/keybindings-store';
import {createFileKeybindingsStore} from '../../app/config/keybindings-store';

export const FILE_NAME = 'keybindings.json5';
export const TEMPORARY_PREFIX = `.${FILE_NAME}.`;

export type FaultPoint = 'open' | 'write' | 'fsync' | 'chmod' | 'rename';

export const FAULT_POINTS: readonly FaultPoint[] = ['open', 'write', 'fsync', 'chmod', 'rename'];

/** A real `node:fs` surface that tests can override one operation at a time. */
export const realFileSystem = (): KeybindingsFileSystem => ({...fs});

/** Replaces exactly the operation named by the fault point. */
const FAULT_OVERRIDES: Readonly<Record<FaultPoint, (fail: () => never) => KeybindingsFileSystem>> = {
  chmod: (fail) => ({...realFileSystem(), chmodSync: fail}),
  fsync: (fail) => ({...realFileSystem(), fsyncSync: fail}),
  open: (fail) => ({...realFileSystem(), openSync: fail}),
  rename: (fail) => ({...realFileSystem(), renameSync: fail}),
  write: (fail) => ({...realFileSystem(), writeSync: fail})
};

const workspaces: string[] = [];

/** Creates a temporary workspace that {@link cleanupWorkspaces} will remove. */
export const createWorkspace = (): string => {
  const workspace = fs.mkdtempSync(path.join(tmpdir(), 'velocetty-keybindings-store-'));
  workspaces.push(workspace);
  return workspace;
};

/** Removes every workspace created in this suite; register with `afterEach`. */
export const cleanupWorkspaces = (): void => {
  for (const workspace of workspaces.splice(0)) {
    fs.rmSync(workspace, {recursive: true, force: true});
  }
};

export const errorWithCode = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), {code});

/** The adapter's own temporary files currently in `directory`. */
export const temporaryNames = (directory: string): readonly string[] =>
  fs.readdirSync(directory).filter((name) => name.startsWith(TEMPORARY_PREFIX) && name.endsWith('.tmp'));

export const targetPathIn = (workspace: string): string => path.join(workspace, FILE_NAME);

/** Each link's recorded target, so a test can prove the links survived intact. */
export const linkTargetsOf = (linkPaths: readonly string[]): readonly string[] =>
  linkPaths.map((linkPath) => {
    expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
    return fs.readlinkSync(linkPath);
  });

/** A store over a dangling `keybindings.json5`, with one filesystem operation replaced. */
export const danglingLinkStoreWith = (overrides: Partial<KeybindingsFileSystem>) => {
  const workspace = createWorkspace();
  const realPath = path.join(workspace, 'dotfiles-keybindings.json5');
  const linkPath = targetPathIn(workspace);
  fs.symlinkSync(path.basename(realPath), linkPath);
  const store = createFileKeybindingsStore({filePath: linkPath, fs: {...realFileSystem(), ...overrides}});
  return {linkPath, realPath, store, workspace};
};

/** Asserts a write was refused and left every link, the target, and the directory untouched. */
export const expectRefusedWrite = ({
  linkPaths,
  store,
  workspace
}: Readonly<{linkPaths: readonly string[]; store: KeybindingsStore; workspace: string}>): void => {
  const targetsBefore = linkTargetsOf(linkPaths);
  expect(store.write('{}').kind).toBe('failed');
  expect(linkTargetsOf(linkPaths)).toEqual(targetsBefore);
  expect(temporaryNames(workspace)).toEqual([]);
};

/**
 * Builds a real `node:fs` surface in which exactly one operation throws.
 *
 * Every other operation is the genuine one, so a fault test exercises the
 * adapter's real open/write/fsync/chmod/rename sequence rather than a
 * handwritten imitation of it.
 */
export const faultingFileSystem = (point: FaultPoint, code = 'EIO') => {
  const reached: FaultPoint[] = [];
  const fail = (): never => {
    reached.push(point);
    throw errorWithCode(code);
  };
  return {fileSystem: FAULT_OVERRIDES[point](fail), reached};
};

/** Fails the first `failures` renames with `code`, then delegates. */
const transientRenameFileSystem = (failures: number, code: string) => {
  let attempts = 0;
  const fileSystem: KeybindingsFileSystem = {
    ...realFileSystem(),
    renameSync: (from, to) => {
      attempts += 1;
      if (attempts <= failures) {
        throw errorWithCode(code);
      }
      fs.renameSync(from, to);
    }
  };
  return {fileSystem, attempts: () => attempts};
};

/** Prepares a store over an existing target whose first renames fail with `code`. */
export const setupRenameFailure = (failures: number, code: string) => {
  const workspace = createWorkspace();
  const filePath = targetPathIn(workspace);
  fs.writeFileSync(filePath, 'previous', 'utf8');
  const {fileSystem, attempts} = transientRenameFileSystem(failures, code);
  const sleep = mock((_milliseconds: number) => {});
  const events: RenameRetryEvent[] = [];
  const store = createFileKeybindingsStore({
    filePath,
    fs: fileSystem,
    onRetry: (event) => {
      events.push(event);
    },
    sleep
  });
  return {attempts, events, filePath, sleep, store, workspace};
};
