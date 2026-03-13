/**
 * @file Verifies the guarded packaged dependency mirror in
 * `bin/copy-node-modules.js`.
 *
 * Responsibilities:
 * - confirm `hasEntries(...)` treats only missing-directory errors as empty
 * - prove unexpected filesystem failures still surface to the caller
 * - verify the native copy step uses Node-supported `fs.cpSync(...)` options
 *
 * Invariants:
 * - `ENOENT` and `ENOTDIR` mean the destination cannot contribute entries yet
 * - other `readdirSync(...)` failures remain actionable errors
 * - the mirror step continues to copy recursively with `force: true`
 *
 * Usage:
 * - run this module directly with
 *   `bun test test/unit/copy-node-modules.test.ts`
 *
 * Cross-link: `../../bin/copy-node-modules.js`.
 */
import {expect, test} from 'bun:test';
import path from 'node:path';

import {copyNodeModules, hasEntries} from '../../bin/copy-node-modules.js';

const createNodeError = (code: string, message: string) => {
  const error = new Error(message) as Error & {code: string};
  error.code = code;
  return error;
};

test('treats a missing directory as empty', () => {
  const fsModule = {
    readdirSync: () => {
      throw createNodeError('ENOENT', 'missing');
    }
  };

  expect(hasEntries('/tmp/missing', fsModule)).toBe(false);
});

test('treats a non-directory path as empty', () => {
  const fsModule = {
    readdirSync: () => {
      throw createNodeError('ENOTDIR', 'not a directory');
    }
  };

  expect(hasEntries('/tmp/file', fsModule)).toBe(false);
});

test('rethrows unexpected directory read failures', () => {
  const failure = createNodeError('EACCES', 'permission denied');
  const fsModule = {
    readdirSync: () => {
      throw failure;
    }
  };

  expect(() => hasEntries('/tmp/protected', fsModule)).toThrow(failure);
});

test('copies with Node-supported cpSync options', () => {
  const cpSyncCalls: Array<{
    destinationDir: string;
    options: Record<string, unknown>;
    sourceDir: string;
  }> = [];
  const loggerMessages: string[] = [];
  const baseDir = '/workspace';
  const fsModule = {
    cpSync: (sourceDir: string, destinationDir: string, options: Record<string, unknown>) => {
      cpSyncCalls.push({sourceDir, destinationDir, options});
    },
    existsSync: (targetPath: string) => {
      return targetPath === path.join(baseDir, 'dist', 'app', 'node_modules');
    },
    readdirSync: () => [],
    rmSync: () => {}
  };

  copyNodeModules({
    baseDir,
    fsModule,
    logger: (message: string) => {
      loggerMessages.push(message);
    }
  });

  expect(cpSyncCalls).toHaveLength(1);
  expect(cpSyncCalls[0]).toEqual({
    sourceDir: '/workspace/dist/app/node_modules',
    destinationDir: '/workspace/app/node_modules',
    options: {
      recursive: true,
      force: true,
      dereference: false,
      filter: expect.any(Function)
    }
  });
  expect(cpSyncCalls[0]?.options).not.toHaveProperty('errorOnExist');
  expect(loggerMessages).toEqual([
    'Copying node_modules from /workspace/dist/app/node_modules to /workspace/app/node_modules'
  ]);
});
