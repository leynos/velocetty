/** @file Directory cleanup with bounded retries for transient Windows locks. */
/*
 * Windows keeps a directory locked for a short time after a child process
 * exits, so an E2E teardown that deletes one immediately can lose to the
 * operating system rather than to a real failure. This module is the whole
 * retry policy for that case, kept apart from the launch helpers so each file
 * stays focused.
 */
import fs from 'node:fs/promises';

import {isObject, isString} from '@shared/types/guards';

export type RemoveDirectoryWithRetryOptions = Readonly<{
  maxAttempts?: number;
  baseDelayMs?: number;
  isWindows?: boolean;
  removeDirectory?: (directory: string) => Promise<void>;
  sleepFn?: (ms: number) => Promise<void>;
}>;

const windowsRetriableCleanupErrorCodes = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY']);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const removeDirectoryRecursive = async (directory: string) => {
  await fs.rm(directory, {recursive: true, force: true});
};

const isRetriableCleanupError = (error: unknown, isWindows: boolean) => {
  if (!isWindows) {
    return false;
  }

  if (!isObject(error) || !('code' in error)) {
    return false;
  }
  const code = error.code;
  return isString(code) && windowsRetriableCleanupErrorCodes.has(code);
};

/**
 * Removes a directory, retrying only the errors that mean "not yet".
 *
 * The delay doubles from `baseDelayMs` on each attempt. Every other error, and
 * the final failure once `maxAttempts` is spent, is rethrown so a teardown
 * problem is never mistaken for a passing run.
 *
 * @param directory - The directory to remove.
 * @param options - Retry bounds and injected collaborators; see the type.
 * @returns A promise that settles once the directory is gone.
 *
 * @example
 * ```ts
 * await removeDirectoryWithRetry('/tmp/e2e-home', {maxAttempts: 5});
 * ```
 */
export const removeDirectoryWithRetry = async (directory: string, options: RemoveDirectoryWithRetryOptions = {}) => {
  const maxAttempts = options.maxAttempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 100;
  const isWindows = options.isWindows ?? process.platform === 'win32';
  const removeDirectory = options.removeDirectory ?? removeDirectoryRecursive;
  const sleepFn = options.sleepFn ?? sleep;

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError('removeDirectoryWithRetry maxAttempts must be an integer greater than 0.');
  }

  if (!Number.isFinite(baseDelayMs) || baseDelayMs <= 0) {
    throw new RangeError('removeDirectoryWithRetry baseDelayMs must be a finite number greater than 0.');
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await removeDirectory(directory);
      return;
    } catch (error) {
      if (attempt >= maxAttempts || !isRetriableCleanupError(error, isWindows)) {
        throw error;
      }

      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      await sleepFn(delayMs);
    }
  }
};
