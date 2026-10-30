/** @file KB-STORE-1: atomic, non-destructive writes through the file adapter. */
import {afterEach, describe, expect, mock, test} from 'bun:test';

import * as fs from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

import type {KeybindingsFileSystem} from '../../app/config/keybindings-store';
import {createFileKeybindingsStore} from '../../app/config/keybindings-store';

const FILE_NAME = 'keybindings.json5';
const TEMPORARY_PREFIX = `.${FILE_NAME}.`;

type FaultPoint = 'open' | 'write' | 'fsync' | 'chmod' | 'rename';

const FAULT_POINTS: readonly FaultPoint[] = ['open', 'write', 'fsync', 'chmod', 'rename'];

/** A real `node:fs` surface that tests can override one operation at a time. */
const realFileSystem = (): KeybindingsFileSystem => ({...fs});

/** Replaces exactly the operation named by the fault point. */
const FAULT_OVERRIDES: Readonly<Record<FaultPoint, (fail: () => never) => KeybindingsFileSystem>> = {
  chmod: (fail) => ({...realFileSystem(), chmodSync: fail}),
  fsync: (fail) => ({...realFileSystem(), fsyncSync: fail}),
  open: (fail) => ({...realFileSystem(), openSync: fail}),
  rename: (fail) => ({...realFileSystem(), renameSync: fail}),
  write: (fail) => ({...realFileSystem(), writeSync: fail})
};

const workspaces: string[] = [];

const createWorkspace = (): string => {
  const workspace = fs.mkdtempSync(path.join(tmpdir(), 'velocetty-keybindings-store-'));
  workspaces.push(workspace);
  return workspace;
};

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    fs.rmSync(workspace, {recursive: true, force: true});
  }
});

const errorWithCode = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), {code});

const temporaryNames = (directory: string): readonly string[] =>
  fs.readdirSync(directory).filter((name) => name.startsWith(TEMPORARY_PREFIX) && name.endsWith('.tmp'));

const targetPathIn = (workspace: string): string => path.join(workspace, FILE_NAME);

/**
 * Builds a real `node:fs` surface in which exactly one operation throws.
 *
 * Every other operation is the genuine one, so a fault test exercises the
 * adapter's real open/write/fsync/chmod/rename sequence rather than a
 * hand-written imitation of it.
 */
const faultingFileSystem = (point: FaultPoint, code = 'EIO') => {
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

describe('atomic keybindings file store', () => {
  test('reads a present file, a missing file, and an unreadable file', () => {
    const workspace = createWorkspace();
    const filePath = targetPathIn(workspace);
    const store = createFileKeybindingsStore({filePath});

    expect(store.read()).toEqual({kind: 'missing'});

    fs.writeFileSync(filePath, `{'window:new': 'ctrl+n'}`, 'utf8');
    expect(store.read()).toEqual({kind: 'present', text: `{'window:new': 'ctrl+n'}`});

    const unreadable = createFileKeybindingsStore({
      filePath,
      fs: {
        ...realFileSystem(),
        readFileSync: () => {
          throw errorWithCode('EACCES');
        }
      }
    });
    expect(unreadable.read().kind).toBe('unreadable');
  });

  test('writes the replacement bytes and preserves the target mode', () => {
    const workspace = createWorkspace();
    const filePath = targetPathIn(workspace);
    fs.writeFileSync(filePath, '{}', 'utf8');
    fs.chmodSync(filePath, 0o640);
    const store = createFileKeybindingsStore({filePath});

    expect(store.write(`{'window:new': 'ctrl+n'}`)).toEqual({kind: 'written'});

    expect(fs.readFileSync(filePath, 'utf8')).toBe(`{'window:new': 'ctrl+n'}`);
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o640);
    expect(temporaryNames(workspace)).toEqual([]);
  });

  test('creates a missing file', () => {
    const workspace = createWorkspace();
    const store = createFileKeybindingsStore({filePath: targetPathIn(workspace)});

    expect(store.write('{}')).toEqual({kind: 'written'});
    expect(fs.readFileSync(targetPathIn(workspace), 'utf8')).toBe('{}');
  });

  test('keeps a symlink and replaces the file it points at', () => {
    const workspace = createWorkspace();
    const realPath = path.join(workspace, 'dotfiles-keybindings.json5');
    const linkPath = targetPathIn(workspace);
    fs.writeFileSync(realPath, '{}', 'utf8');
    fs.symlinkSync(path.basename(realPath), linkPath);
    const store = createFileKeybindingsStore({filePath: linkPath});

    expect(store.write(`{'window:new': 'ctrl+n'}`)).toEqual({kind: 'written'});

    expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(linkPath)).toBe(path.basename(realPath));
    expect(fs.readFileSync(realPath, 'utf8')).toBe(`{'window:new': 'ctrl+n'}`);
    expect(temporaryNames(workspace)).toEqual([]);
  });

  for (const point of FAULT_POINTS) {
    test(`reports failure and preserves the previous bytes when ${point} fails`, () => {
      const workspace = createWorkspace();
      const filePath = targetPathIn(workspace);
      fs.writeFileSync(filePath, 'previous', 'utf8');
      const {fileSystem, reached} = faultingFileSystem(point);
      const store = createFileKeybindingsStore({filePath, fs: fileSystem});

      const outcome = store.write('replacement');

      expect(outcome.kind).toBe('failed');
      expect(reached).toEqual([point]);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('previous');
      expect(temporaryNames(workspace)).toEqual([]);
    });
  }

  test('reports a read-only target as failed without touching it', () => {
    const workspace = createWorkspace();
    const filePath = targetPathIn(workspace);
    fs.writeFileSync(filePath, 'previous', 'utf8');
    const {fileSystem} = faultingFileSystem('open', 'EACCES');
    const store = createFileKeybindingsStore({filePath, fs: fileSystem});

    expect(store.write('replacement').kind).toBe('failed');

    expect(fs.readFileSync(filePath, 'utf8')).toBe('previous');
    expect(temporaryNames(workspace)).toEqual([]);
  });

  test('retries a transient rename failure and succeeds', () => {
    const workspace = createWorkspace();
    const filePath = targetPathIn(workspace);
    fs.writeFileSync(filePath, 'previous', 'utf8');
    const {fileSystem, attempts} = transientRenameFileSystem(2, 'EBUSY');
    const sleep = mock((_milliseconds: number) => {});
    const store = createFileKeybindingsStore({filePath, fs: fileSystem, sleep});

    expect(store.write('replacement')).toEqual({kind: 'written'});

    expect(attempts()).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('replacement');
    expect(temporaryNames(workspace)).toEqual([]);
  });

  test('gives up after five transient rename failures', () => {
    const workspace = createWorkspace();
    const filePath = targetPathIn(workspace);
    fs.writeFileSync(filePath, 'previous', 'utf8');
    const {fileSystem, attempts} = transientRenameFileSystem(Number.POSITIVE_INFINITY, 'EPERM');
    const sleep = mock((_milliseconds: number) => {});
    const store = createFileKeybindingsStore({filePath, fs: fileSystem, sleep});

    expect(store.write('replacement').kind).toBe('failed');

    expect(attempts()).toBe(5);
    expect(sleep).toHaveBeenCalledTimes(4);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('previous');
    expect(temporaryNames(workspace)).toEqual([]);
  });

  test('does not retry a permanent rename failure', () => {
    const workspace = createWorkspace();
    const filePath = targetPathIn(workspace);
    fs.writeFileSync(filePath, 'previous', 'utf8');
    const {fileSystem, attempts} = transientRenameFileSystem(1, 'ENOENT');
    const sleep = mock((_milliseconds: number) => {});
    const store = createFileKeybindingsStore({filePath, fs: fileSystem, sleep});

    expect(store.write('replacement').kind).toBe('failed');

    expect(attempts()).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(temporaryNames(workspace)).toEqual([]);
  });

  test('removes only its own stale temporary files', () => {
    const workspace = createWorkspace();
    const filePath = targetPathIn(workspace);
    const ownStale = path.join(workspace, `${TEMPORARY_PREFIX}4242.0.tmp`);
    const ownOther = path.join(workspace, `${TEMPORARY_PREFIX}4242.1.tmp`);
    const foreign = path.join(workspace, '.other.json5.1.2.tmp');
    fs.writeFileSync(ownStale, 'stale', 'utf8');
    fs.writeFileSync(ownOther, 'stale', 'utf8');
    fs.writeFileSync(foreign, 'foreign', 'utf8');
    const store = createFileKeybindingsStore({filePath});

    store.removeStaleTemporaryFiles();

    expect(fs.existsSync(ownStale)).toBe(false);
    expect(fs.existsSync(ownOther)).toBe(false);
    expect(fs.existsSync(foreign)).toBe(true);
  });
});
