/**
 * @file Verifies the guarded packaged dependency mirror in
 * `bin/copy-node-modules.mjs`.
 *
 * Responsibilities:
 * - verify the copy step skips when the packaged dependency tree is missing but stale app output remains
 * - verify the copy step still fails when both dependency trees are missing
 * - verify the native copy step uses Node-supported `fs.cpSync(...)` options
 *
 * Invariants:
 * - stale app output can satisfy the packaged dependency mirror when the source tree is missing
 * - missing packaged dependencies remain a hard failure only when no destination tree exists
 * - the mirror step continues to copy recursively with `force: true`
 *
 * Usage:
 * - run this module directly with
 *   `bun test test/unit/copy-node-modules.test.ts`
 *
 * Cross-link: `../../bin/copy-node-modules.mjs`.
 */
import {expect, test} from 'bun:test';
import path from 'node:path';

import {copyNodeModules} from '../../bin/copy-node-modules.mjs';

test('skips when the packaged source tree is missing but stale app output already exists', () => {
  const baseDir = '/workspace';
  const rmSyncCalls: string[] = [];
  const cpSyncCalls: string[] = [];
  const loggerMessages: string[] = [];
  const destinationDir = path.join(baseDir, 'app', 'node_modules');
  const fsModule = {
    cpSync: (sourceDir: string) => {
      cpSyncCalls.push(sourceDir);
    },
    existsSync: (targetPath: string) => {
      return targetPath === destinationDir;
    },
    rmSync: (targetPath: string) => {
      rmSyncCalls.push(targetPath);
    }
  };

  copyNodeModules({
    baseDir,
    fsModule,
    logger: (message: string) => {
      loggerMessages.push(message);
    }
  });

  expect(rmSyncCalls).toEqual([]);
  expect(cpSyncCalls).toEqual([]);
  expect(loggerMessages).toEqual([
    `Skipping node_modules mirror: source missing at ${path.join(baseDir, 'dist', 'app', 'node_modules')}, destination already exists at ${destinationDir}`
  ]);
});

test('fails when both packaged and app dependency trees are missing', () => {
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

interface CopyFixture {
  baseDir: string;
  cpSyncCalls: Array<{
    destinationDir: string;
    options: Record<string, unknown>;
    sourceDir: string;
  }>;
  destinationDir: string;
  fsModule: {
    cpSync: (sourceDir: string, destinationDir: string, options: Record<string, unknown>) => void;
    existsSync: (targetPath: string) => boolean;
    rmSync: (targetPath: string, options?: Record<string, unknown>) => void;
  };
  logger: (message: string) => void;
  loggerMessages: string[];
  rmSyncCalls: Array<{
    options: Record<string, unknown> | undefined;
    targetPath: string;
  }>;
  sourceDir: string;
}

const makeCopyFixture = (): CopyFixture => {
  const cpSyncCalls: CopyFixture['cpSyncCalls'] = [];
  const loggerMessages: string[] = [];
  const rmSyncCalls: CopyFixture['rmSyncCalls'] = [];
  const baseDir = '/workspace';
  const sourceDir = path.join(baseDir, 'dist', 'app', 'node_modules');
  const destinationDir = path.join(baseDir, 'app', 'node_modules');
  const fsModule: CopyFixture['fsModule'] = {
    cpSync: (sourceDir: string, destinationDir: string, options: Record<string, unknown>) => {
      cpSyncCalls.push({sourceDir, destinationDir, options});
    },
    existsSync: (targetPath: string) => {
      return targetPath === sourceDir;
    },
    rmSync: (targetPath: string, options?: Record<string, unknown>) => {
      rmSyncCalls.push({targetPath, options});
    }
  };
  const logger = (message: string) => {
    loggerMessages.push(message);
  };

  return {
    baseDir,
    cpSyncCalls,
    destinationDir,
    fsModule,
    logger,
    loggerMessages,
    rmSyncCalls,
    sourceDir
  };
};

test('copies with Node-supported cpSync options', () => {
  const {baseDir, cpSyncCalls, destinationDir, fsModule, logger, loggerMessages, rmSyncCalls, sourceDir} =
    makeCopyFixture();

  copyNodeModules({baseDir, fsModule, logger});

  expect(rmSyncCalls).toEqual([
    {
      targetPath: destinationDir,
      options: {
        recursive: true,
        force: true
      }
    }
  ]);
  expect(cpSyncCalls).toHaveLength(1);
  expect(cpSyncCalls[0]).toEqual({
    sourceDir,
    destinationDir,
    options: {
      recursive: true,
      force: true,
      dereference: false,
      filter: expect.any(Function)
    }
  });
  expect(cpSyncCalls[0]?.options).not.toHaveProperty('errorOnExist');
  expect(loggerMessages).toEqual([`Copying node_modules from ${sourceDir} to ${destinationDir}`]);
});
