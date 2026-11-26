/**
 * @file Real-file-system cases for the config writer.
 *
 * These exercise the parts the in-memory port cannot: file modes, symlinked
 * configs, directory permissions, and the atomic rename itself.
 */
import {describe, expect, test} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  asConfigFilePath,
  lastPathSegment,
  type ConfigWriteGuard,
  type ConfigWriterDependencies,
  TEMPORARY_FILE_PREFIX,
  sweepTemporaryFiles,
  writeConfigEdit
} from '../../app/config/config-file-writer';
import {createNodeConfigFileSystem} from '../../app/config/node-config-file-port';
import {checkWritePolicy} from '../../app/settings/settings-write-policy';

const guard: ConfigWriteGuard = {
  checkPolicy: (segments, value) => checkWritePolicy(lastPathSegment(segments), value)
};

const writerDependencies = (): ConfigWriterDependencies => {
  let revision = 0;
  return {
    fileSystem: createNodeConfigFileSystem(),
    sleep: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
    },
    log: () => {
      // Deliberately quiet in tests.
    },
    platform: process.platform,
    processId: () => process.pid,
    nextRevision: () => {
      revision += 1;
      return revision;
    },
    currentRevision: () => revision,
    recordWrittenText: () => {
      // The state module is covered by its own suite.
    }
  };
};

const withTemporaryDirectory = async (run: (directory: string) => Promise<void>): Promise<void> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'velocetty-config-writer-'));
  try {
    await run(directory);
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
};

const setFontSize = async (dependencies: ConfigWriterDependencies, filePath: string, value: number) =>
  writeConfigEdit(dependencies, filePath, {kind: 'set', path: ['config', 'fontSize'], value}, guard);

describe('config writer on a real file system', () => {
  test('writes through a rename and keeps the file mode', async () => {
    await withTemporaryDirectory(async (directory) => {
      const filePath = path.join(directory, 'config.json5');
      await fs.writeFile(filePath, '{\n  config: {\n    fontSize: 14\n  }\n}\n', {mode: 0o640});
      await fs.chmod(filePath, 0o640);

      const outcome = await setFontSize(writerDependencies(), filePath, 16);

      expect(outcome.kind).toBe('written');
      // Windows reports synthesized permission bits, so only a POSIX file
      // system can prove that the original mode survived the rename.
      if (process.platform !== 'win32') {
        const stats = await fs.stat(filePath);
        expect(stats.mode & 0o777).toBe(0o640);
      }
      expect(await fs.readFile(filePath, 'utf8')).toContain('fontSize: 16');
    });
  });

  test('leaves a symlinked config a symlink and updates its target', async () => {
    await withTemporaryDirectory(async (directory) => {
      const target = path.join(directory, 'dotfiles-config.json5');
      const link = path.join(directory, 'config.json5');
      await fs.writeFile(target, '{config: {fontSize: 14}}');
      await fs.symlink(target, link);

      const outcome = await setFontSize(writerDependencies(), link, 18);

      expect(outcome.kind).toBe('written');
      const linkStats = await fs.lstat(link);
      expect(linkStats.isSymbolicLink()).toBe(true);
      expect(await fs.readFile(target, 'utf8')).toContain('fontSize: 18');
    });
  });

  test('refuses to write into a read-only directory and leaves no temporary file', async () => {
    if (process.platform === 'win32') {
      return;
    }
    await withTemporaryDirectory(async (directory) => {
      const filePath = path.join(directory, 'config.json5');
      await fs.writeFile(filePath, '{config: {fontSize: 14}}');
      const original = await fs.readFile(filePath, 'utf8');
      await fs.chmod(directory, 0o500);
      try {
        const outcome = await setFontSize(writerDependencies(), filePath, 16);
        expect(outcome).toEqual({kind: 'refused', reason: 'io-error'});
        expect(await fs.readFile(filePath, 'utf8')).toBe(original);
      } finally {
        await fs.chmod(directory, 0o700);
      }
      const entries = await fs.readdir(directory);
      const leftovers = entries.filter((entry) => entry.startsWith(TEMPORARY_FILE_PREFIX));
      expect(leftovers).toEqual([]);
    });
  });

  test('sweeps abandoned temporary files at start-up', async () => {
    await withTemporaryDirectory(async (directory) => {
      const keep = path.join(directory, 'config.json5');
      const stale = path.join(directory, `${TEMPORARY_FILE_PREFIX}999-1`);
      await fs.writeFile(keep, '{}');
      await fs.writeFile(stale, 'partial');

      expect(sweepTemporaryFiles(createNodeConfigFileSystem(), asConfigFilePath(directory))).toBe(1);
      expect(await fs.readdir(directory)).toEqual(['config.json5']);
    });
  });
});
