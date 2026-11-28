/**
 * @file In-memory file-system port for config writer and service tests.
 *
 * The port records every write so a test can assert that a refused edit never
 * reached disk. Faults can be queued per operation to exercise the retry path.
 */

import path from 'node:path';

import {asConfigFilePath, type ConfigFileSystemPort} from '../../app/config/config-file-writer';

type StoredFile = {text: string; mode: number};

type Fault = {readonly operation: keyof ConfigFileSystemPort; readonly code: string};

/** The in-memory port plus the assertions a test needs. */
export type MemoryConfigFileSystem = ConfigFileSystemPort & {
  readonly files: Map<string, StoredFile>;
  readonly writes: readonly {readonly path: string; readonly text: string; readonly mode: number}[];
  readonly setFile: (filePath: string, text: string, mode?: number) => void;
  readonly readFile: (filePath: string) => string | undefined;
  readonly setSymlink: (linkPath: string, targetPath: string) => void;
  readonly queueFault: (operation: keyof ConfigFileSystemPort, code: string) => void;
  readonly clearWrites: () => void;
};

const fail = (code: string): never => {
  const error = new Error(code);
  Object.assign(error, {code});
  throw error;
};

/**
 * Builds an in-memory port.
 *
 * @returns The port with helpers to seed files, symlinks, and faults.
 *
 * @example
 * const port = createMemoryConfigFileSystem();
 * port.setFile('/config.json5', '{config: {}}');
 */
export const createMemoryConfigFileSystem = (): MemoryConfigFileSystem => {
  const files = new Map<string, StoredFile>();
  const symlinks = new Map<string, string>();
  const writes: {path: string; text: string; mode: number}[] = [];
  const faults: Fault[] = [];

  const consumeFault = (operation: keyof ConfigFileSystemPort): void => {
    const index = faults.findIndex((fault) => fault.operation === operation);
    if (index === -1) {
      return;
    }
    for (const fault of faults.splice(index, 1)) {
      fail(fault.code);
    }
  };

  const resolve = (filePath: string): string => symlinks.get(filePath) ?? filePath;

  const port: MemoryConfigFileSystem = {
    files,
    writes,
    setFile: (filePath, text, mode = 0o600) => {
      files.set(filePath, {text, mode});
    },
    readFile: (filePath) => files.get(resolve(filePath))?.text,
    setSymlink: (linkPath, targetPath) => {
      symlinks.set(linkPath, targetPath);
    },
    queueFault: (operation, code) => {
      faults.push({operation, code});
    },
    clearWrites: () => {
      writes.splice(0);
    },
    realpath: (filePath) => {
      consumeFault('realpath');
      const target = resolve(filePath);
      if (!files.has(target)) {
        fail('ENOENT');
      }
      return asConfigFilePath(target);
    },
    readText: (filePath) => {
      consumeFault('readText');
      const stored = files.get(resolve(filePath));
      if (!stored) {
        return fail('ENOENT');
      }
      return stored.text;
    },
    stat: (filePath) => {
      consumeFault('stat');
      const stored = files.get(resolve(filePath));
      return stored ? {mode: stored.mode} : null;
    },
    writeFile: (filePath, text, mode) => {
      consumeFault('writeFile');
      files.set(filePath, {text, mode});
      writes.push({path: filePath, text, mode});
    },
    fsyncFile: (filePath) => {
      consumeFault('fsyncFile');
      if (!files.has(filePath)) {
        return fail('ENOENT');
      }
    },
    rename: (fromPath, toPath) => {
      consumeFault('rename');
      const stored = files.get(fromPath);
      if (!stored) {
        return fail('ENOENT');
      }
      files.delete(fromPath);
      files.set(toPath, stored);
    },
    unlink: (filePath) => {
      consumeFault('unlink');
      if (!files.delete(filePath)) {
        return fail('ENOENT');
      }
    },
    readdir: (directory) => {
      consumeFault('readdir');
      const prefix = directory.endsWith(path.sep) ? directory : `${directory}${path.sep}`;
      return [...files.keys()].flatMap((file) => (file.startsWith(prefix) ? [file.slice(prefix.length)] : []));
    },
    fsyncDirectory: () => {
      consumeFault('fsyncDirectory');
    }
  };

  return port;
};
