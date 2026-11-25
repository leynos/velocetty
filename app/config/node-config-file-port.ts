/**
 * @file Node adapter for the config writer's synchronous file-system port.
 */

import fs from 'node:fs';

import {isString} from '../utils/runtime-guards';
import type {ConfigFileStat, ConfigFileSystemPort} from './config-file-writer';

const isMissing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && isString(error.code) && error.code === 'ENOENT';

/**
 * Builds the production file-system port.
 *
 * @returns A synchronous port backed by `node:fs`.
 *
 * @example
 * createNodeConfigFileSystem().stat('/missing'); // null
 */
export const createNodeConfigFileSystem = (): ConfigFileSystemPort => ({
  realpath: (filePath) => fs.realpathSync(filePath),
  readText: (filePath) => fs.readFileSync(filePath, 'utf8'),
  stat: (filePath): ConfigFileStat | null => {
    try {
      const stats = fs.statSync(filePath);
      return {mode: stats.mode & 0o777};
    } catch (error) {
      if (isMissing(error)) {
        return null;
      }
      throw error;
    }
  },
  writeFile: (filePath, text, mode) => {
    fs.writeFileSync(filePath, text, {encoding: 'utf8', mode});
  },
  fsyncFile: (filePath) => {
    const descriptor = fs.openSync(filePath, 'r+');
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  },
  rename: (fromPath, toPath) => {
    fs.renameSync(fromPath, toPath);
  },
  unlink: (filePath) => {
    fs.unlinkSync(filePath);
  },
  readdir: (directory) => fs.readdirSync(directory),
  fsyncDirectory: (directory) => {
    const descriptor = fs.openSync(directory, 'r');
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  }
});
