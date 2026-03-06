/**
 * @file Verifies the symlink-aware directory bootstrap behaviour shared by the
 * build and packaging scripts.
 *
 * Responsibilities:
 * - assert that `ensureDirectoryPath(...)` preserves existing directories and
 *   their contents
 * - verify recursive directory creation for missing paths
 * - confirm symlink resolution creates the backing directory target rather than
 *   replacing the symlink
 * - prove non-directory paths fail with a stable error contract
 *
 * Invariants:
 * - directory creation is idempotent for existing paths
 * - symlink paths remain symlinks after bootstrap
 * - resolved symlink targets are materialized as directories
 * - each test runs in an isolated temporary root that is removed during
 *   teardown
 *
 * Usage:
 * - run this module directly with
 *   `bun test --max-concurrency=1 test/unit/ensure-directory-path.test.ts`
 * - the suite manages its own temporary directories via `afterEach`, so no
 *   manual fixture cleanup is required
 *
 * Related modules:
 * - `../../bin/shared/ensure-directory-path.js` implements the helper under
 *   test
 * - `../../bin/ensure-dist-dir.js` and `../../bin/mk-snapshot.js` consume the
 *   same bootstrap semantics in build-script entrypoints
 */
import {afterEach, expect, test} from 'bun:test';
import {lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {ensureDirectoryPath} from '../../bin/shared/ensure-directory-path.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'ensure-directory-path-'));
  temporaryRoots.push(temporaryRoot);
  return temporaryRoot;
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((temporaryRoot) => rm(temporaryRoot, {recursive: true, force: true})));
});

test('returns without changing an existing directory', async () => {
  const temporaryRoot = await createTemporaryRoot();
  const existingDirectory = path.join(temporaryRoot, 'existing');
  const sentinelFile = path.join(existingDirectory, 'sentinel.txt');

  await mkdir(existingDirectory, {recursive: true});
  await writeFile(sentinelFile, 'kept');

  await expect(ensureDirectoryPath(existingDirectory)).resolves.toBeUndefined();

  await expect(readFile(sentinelFile, 'utf8')).resolves.toBe('kept');
  const existingDirectoryStats = await lstat(existingDirectory);
  expect(existingDirectoryStats.isDirectory()).toBe(true);
});

test('creates a missing directory path recursively', async () => {
  const temporaryRoot = await createTemporaryRoot();
  const missingDirectory = path.join(temporaryRoot, 'nested', 'output');

  await expect(ensureDirectoryPath(missingDirectory)).resolves.toBeUndefined();
  const missingDirectoryStats = await lstat(missingDirectory);
  expect(missingDirectoryStats.isDirectory()).toBe(true);
});

test('creates the resolved target when the directory path is a symlink', async () => {
  const temporaryRoot = await createTemporaryRoot();
  const symlinkPath = path.join(temporaryRoot, 'dist');
  const targetDirectory = path.join(temporaryRoot, 'backing', 'dist');
  const relativeTarget = path.relative(path.dirname(symlinkPath), targetDirectory);

  await symlink(relativeTarget, symlinkPath, 'dir');

  await expect(ensureDirectoryPath(symlinkPath)).resolves.toBeUndefined();

  const symlinkStat = await lstat(symlinkPath);
  const targetStat = await lstat(targetDirectory);

  expect(symlinkStat.isSymbolicLink()).toBe(true);
  expect(targetStat.isDirectory()).toBe(true);
});

test('rejects paths that are neither directories nor symlinks', async () => {
  const temporaryRoot = await createTemporaryRoot();
  const filePath = path.join(temporaryRoot, 'not-a-directory.txt');

  await writeFile(filePath, 'not a directory');

  await expect(ensureDirectoryPath(filePath)).rejects.toThrow(`Expected "${filePath}" to be a directory path.`);
});
