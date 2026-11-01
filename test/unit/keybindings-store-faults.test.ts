/** @file KB-STORE-1 fault injection: atomic-write failures and rename retries. */
import {afterEach, describe, expect, test} from 'bun:test';

import * as fs from 'node:fs';

import {createFileKeybindingsStore} from '../../app/config/keybindings-store';
import {
  cleanupWorkspaces,
  createWorkspace,
  FAULT_POINTS,
  faultingFileSystem,
  setupRenameFailure,
  targetPathIn,
  temporaryNames
} from '../testUtils/keybindings-store-harness';

afterEach(cleanupWorkspaces);

describe('atomic write failures', () => {
  for (const point of FAULT_POINTS) {
    test(`reports failure and preserves the previous bytes when ${point} fails`, () => {
      const workspace = createWorkspace();
      const filePath = targetPathIn(workspace);
      fs.writeFileSync(filePath, 'previous', 'utf8');
      const {fileSystem, reached} = faultingFileSystem(point);
      const store = createFileKeybindingsStore({filePath, fs: fileSystem, warn: () => {}});

      const outcome = store.write('replacement');

      expect(outcome.kind).toBe('failed');
      expect(reached).toEqual([point]);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('previous');
      expect(temporaryNames(workspace)).toEqual([]);
    });
  }

  test('reports a failed temporary-file creation without touching the target', () => {
    const workspace = createWorkspace();
    const filePath = targetPathIn(workspace);
    fs.writeFileSync(filePath, 'previous', 'utf8');
    const {fileSystem} = faultingFileSystem('open', 'EACCES');
    const store = createFileKeybindingsStore({filePath, fs: fileSystem, warn: () => {}});

    expect(store.write('replacement')).toEqual({failure: 'permission', kind: 'failed'});

    expect(fs.readFileSync(filePath, 'utf8')).toBe('previous');
    expect(temporaryNames(workspace)).toEqual([]);
  });

  // Windows models only a read-only attribute, and a POSIX rename over a
  // read-only file still succeeds when the directory is writable, so the
  // refusal is asserted where it is meaningful. Root bypasses POSIX permission
  // bits, so `accessSync(W_OK)` succeeds there too.
  const cannotModelReadOnly = process.platform === 'win32' || process.getuid?.() === 0;
  test.skipIf(cannotModelReadOnly)('refuses a read-only target before creating anything', () => {
    const workspace = createWorkspace();
    const filePath = targetPathIn(workspace);
    fs.writeFileSync(filePath, 'previous', 'utf8');
    fs.chmodSync(filePath, 0o444);
    const store = createFileKeybindingsStore({filePath, warn: () => {}});

    const outcome = store.write('replacement');

    expect(outcome).toEqual({failure: 'permission', kind: 'failed'});
    expect(fs.readFileSync(filePath, 'utf8')).toBe('previous');
    expect(temporaryNames(workspace)).toEqual([]);
  });
});

describe('rename retries', () => {
  test('retries a transient rename failure and succeeds', () => {
    const {attempts, events, filePath, sleep, store, workspace} = setupRenameFailure(2, 'EBUSY');

    expect(store.write('replacement')).toEqual({kind: 'written'});

    expect(attempts()).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('replacement');
    expect(temporaryNames(workspace)).toEqual([]);
    // Each refusal is reported, but a retry that later succeeds was not a
    // failed write, so no event claims exhaustion.
    expect(events).toEqual([
      {attempt: 1, category: 'busy', exhausted: false},
      {attempt: 2, category: 'busy', exhausted: false}
    ]);
  });

  test('gives up after five transient rename failures', () => {
    const {attempts, events, filePath, sleep, store, workspace} = setupRenameFailure(Number.POSITIVE_INFINITY, 'EPERM');

    expect(store.write('replacement').kind).toBe('failed');

    expect(attempts()).toBe(5);
    expect(sleep).toHaveBeenCalledTimes(4);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('previous');
    expect(temporaryNames(workspace)).toEqual([]);
    // Exactly one event marks the end, and it is the last attempt.
    expect(events.map((event) => event.attempt)).toEqual([1, 2, 3, 4, 5]);
    expect(events.map((event) => event.exhausted)).toEqual([false, false, false, false, true]);
    expect(new Set(events.map((event) => event.category))).toEqual(new Set(['permission']));
  });

  test('does not retry a permanent rename failure', () => {
    const {attempts, events, sleep, store, workspace} = setupRenameFailure(1, 'ENOENT');

    expect(store.write('replacement').kind).toBe('failed');

    expect(attempts()).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(temporaryNames(workspace)).toEqual([]);
    // An unrecognized errno is reported as `other` and ends the write at once.
    expect(events).toEqual([{attempt: 1, category: 'other', exhausted: true}]);
  });

  test('categorizes a refused permission rename as permission', () => {
    const {events, store} = setupRenameFailure(Number.POSITIVE_INFINITY, 'EACCES');

    expect(store.write('replacement').kind).toBe('failed');

    // EACCES is transient on Windows and shares the `permission` category with
    // EPERM, so the two cannot be told apart from the counter alone.
    expect(new Set(events.map((event) => event.category))).toEqual(new Set(['permission']));
  });
});
