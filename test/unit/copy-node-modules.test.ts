/**
 * @file Verifies the guarded packaged dependency mirror in
 * `bin/copy-node-modules.js`.
 *
 * Responsibilities:
 * - verify the copy step fails fast when the packaged dependency tree is missing
 * - verify the native copy step uses Node-supported `fs.cpSync(...)` options
 *
 * Invariants:
 * - missing packaged dependencies remain a hard failure even if stale app output exists
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

import {copyNodeModules} from '../../bin/copy-node-modules.js';

test('fails when the packaged source tree is missing, even if stale app output exists', () => {
  const baseDir = '/workspace';
  const rmSyncCalls: string[] = [];
  const cpSyncCalls: string[] = [];
  const fsModule = {
    cpSync: (sourceDir: string) => {
      cpSyncCalls.push(sourceDir);
    },
    existsSync: () => false,
    rmSync: (targetPath: string) => {
      rmSyncCalls.push(targetPath);
    }
  };

  expect(() => copyNodeModules({baseDir, fsModule})).toThrow(
    `Source node_modules not found at ${path.join(baseDir, 'dist', 'app', 'node_modules')}`
  );
  expect(rmSyncCalls).toEqual([]);
  expect(cpSyncCalls).toEqual([]);
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
