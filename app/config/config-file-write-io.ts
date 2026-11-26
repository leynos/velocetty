/**
 * @file Low-level atomic replacement of the user's config file.
 *
 * This module owns the mechanics every write shares: a sibling temporary file
 * carrying the original mode, an fsync of that file, the rename over the real
 * path, a directory fsync on POSIX, cleanup after a failed rename, and the
 * start-up sweep of abandoned temporary files. `config-file-writer.ts` owns the
 * read-modify-write policy that decides which text to hand here, and re-exports
 * this module's surface so other modules keep one documented import path.
 */

import path from 'node:path';

/** Metadata the writer needs from the file system. */
export type ConfigFileStat = {readonly mode: number};

/** A file path that has crossed the writer's file-system boundary. */
export type ConfigFilePath = string & {readonly brand: 'ConfigFilePath'};

/** Document text that has crossed the writer's file-system boundary. */
export type ConfigFileText = string & {readonly brand: 'ConfigFileText'};

/**
 * Brands a raw path for the file-system port.
 *
 * @param value - The raw path.
 * @returns The same path, branded for the port.
 *
 * @example
 * asConfigFilePath('/home/me/.config/Hyper/config.json5');
 */
export const asConfigFilePath = (value: string): ConfigFilePath =>
  // SAFETY: the brand exists only in the type system; the runtime value stays
  // the string the file-system calls require.
  value as ConfigFilePath;

/**
 * Brands document text for the file-system port.
 *
 * @param value - The raw document text.
 * @returns The same text, branded for the port.
 *
 * @example
 * asConfigFileText('{config: {}}');
 */
export const asConfigFileText = (value: string): ConfigFileText =>
  // SAFETY: the brand exists only in the type system; the runtime value stays
  // the string the file-system calls require.
  value as ConfigFileText;

/**
 * The synchronous file-system operations the writer needs.
 *
 * Every method is synchronous so that the whole read-modify-write is one
 * critical section. Paths and document text are branded so a call site cannot
 * pass one where the other belongs.
 */
export type ConfigFileSystemPort = {
  readonly realpath: (filePath: ConfigFilePath) => ConfigFilePath;
  readonly readText: (filePath: ConfigFilePath) => string;
  readonly stat: (filePath: ConfigFilePath) => ConfigFileStat | null;
  readonly writeFile: (filePath: ConfigFilePath, text: ConfigFileText, mode: number) => void;
  readonly fsyncFile: (filePath: ConfigFilePath) => void;
  readonly rename: (fromPath: ConfigFilePath, toPath: ConfigFilePath) => void;
  readonly unlink: (filePath: ConfigFilePath) => void;
  readonly readdir: (directory: ConfigFilePath) => readonly string[];
  readonly fsyncDirectory: (directory: ConfigFilePath) => void;
};

/** One atomic replacement of a config file's contents. */
export type ConfigFileWriteRequest = {
  readonly fileSystem: ConfigFileSystemPort;
  /** The symlink-resolved path the rename must replace. */
  readonly targetPath: ConfigFilePath;
  /** The complete document text to write. */
  readonly text: ConfigFileText;
  readonly platform: NodeJS.Platform;
  readonly processId: number;
};

/** The prefix every temporary write file uses, so start-up can sweep them. */
export const TEMPORARY_FILE_PREFIX = '.velocetty-config-write-';

const DEFAULT_MODE = 0o600;
let temporaryCounter = 0;

const temporaryPathFor = (targetPath: ConfigFilePath, processId: number): ConfigFilePath => {
  temporaryCounter += 1;
  return asConfigFilePath(
    path.join(path.dirname(targetPath), `${TEMPORARY_FILE_PREFIX}${processId}-${temporaryCounter}`)
  );
};

/**
 * Replaces the target file with `text` in one rename.
 *
 * The temporary sibling carries the target's current mode, so the replacement
 * neither widens nor narrows permissions. The temporary file is fsynced before
 * the rename and the directory after it on POSIX, so a crash leaves either the
 * old or the new document, never a partial one. A failed write or rename
 * removes the temporary file, and the original error is rethrown.
 *
 * @param request - The file-system port, target, text, and write identity.
 *
 * @example
 * writeFileAtomically({
 *   fileSystem: createNodeConfigFileSystem(),
 *   targetPath: '/home/me/.config/Hyper/config.json5',
 *   text: '{config: {}}',
 *   platform: 'linux',
 *   processId: 42
 * });
 */
export const writeFileAtomically = (request: ConfigFileWriteRequest): void => {
  const {fileSystem, targetPath, text, platform, processId} = request;
  const mode = fileSystem.stat(targetPath)?.mode ?? DEFAULT_MODE;
  const temporaryPath = temporaryPathFor(targetPath, processId);
  try {
    fileSystem.writeFile(temporaryPath, text, mode);
    fileSystem.fsyncFile(temporaryPath);
    fileSystem.rename(temporaryPath, targetPath);
  } catch (error) {
    try {
      fileSystem.unlink(temporaryPath);
    } catch {
      // The temporary file may not exist; the original error is the useful one.
    }
    throw error;
  }
  if (platform !== 'win32') {
    fileSystem.fsyncDirectory(asConfigFilePath(path.dirname(targetPath)));
  }
};

/**
 * Removes temporary files left by an interrupted write.
 *
 * @param fileSystem - The file-system port.
 * @param directory - The directory holding the config file.
 * @returns The number of files removed.
 *
 * @example
 * sweepTemporaryFiles(port, '/home/me/.config/Hyper'); // 0
 */
export const sweepTemporaryFiles = (fileSystem: ConfigFileSystemPort, directory: ConfigFilePath): number => {
  let removed = 0;
  for (const entry of fileSystem.readdir(directory)) {
    if (!entry.startsWith(TEMPORARY_FILE_PREFIX)) {
      continue;
    }
    try {
      fileSystem.unlink(asConfigFilePath(path.join(directory, entry)));
      removed += 1;
    } catch {
      // A concurrent sweep may have won; the leftover is harmless.
    }
  }
  return removed;
};
