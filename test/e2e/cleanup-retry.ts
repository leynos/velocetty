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

/** The resolved retry bounds and collaborators for one removal. */
type RetryPolicy = Readonly<{
  readonly baseDelayMs: number;
  readonly isWindows: boolean;
  readonly maxAttempts: number;
  readonly removeDirectory: (directory: string) => Promise<void>;
  readonly sleepFn: (milliseconds: number) => Promise<void>;
}>;

/** One removal attempt, with the policy and attempt number that bound it. */
type RemovalAttempt = Readonly<{
  readonly attempt: number;
  readonly directory: string;
  readonly policy: RetryPolicy;
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

/** Rejects an attempt count no retry loop could honour. */
const requireAttempts = (maxAttempts: number): number => {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError('removeDirectoryWithRetry maxAttempts must be an integer greater than 0.');
  }
  return maxAttempts;
};

/** Rejects a starting delay that would make the backoff meaningless. */
const requireDelay = (baseDelayMs: number): number => {
  if (!Number.isFinite(baseDelayMs) || baseDelayMs <= 0) {
    throw new RangeError('removeDirectoryWithRetry baseDelayMs must be a finite number greater than 0.');
  }
  return baseDelayMs;
};

const resolveRetryPolicy = (options: RemoveDirectoryWithRetryOptions): RetryPolicy => ({
  // Validation order is observable: the attempt count is reported first.
  maxAttempts: requireAttempts(options.maxAttempts ?? 5),
  baseDelayMs: requireDelay(options.baseDelayMs ?? 100),
  isWindows: options.isWindows ?? process.platform === 'win32',
  removeDirectory: options.removeDirectory ?? removeDirectoryRecursive,
  sleepFn: options.sleepFn ?? sleep
});

/**
 * Tries the removal once.
 *
 * @returns `true` when the directory is gone, `false` when a retry is due.
 * @throws The removal error when it is final or not worth retrying.
 */
const attemptRemoval = async ({attempt, directory, policy}: RemovalAttempt): Promise<boolean> => {
  try {
    await policy.removeDirectory(directory);
    return true;
  } catch (error) {
    if (attempt >= policy.maxAttempts || !isRetriableCleanupError(error, policy.isWindows)) {
      throw error;
    }

    await policy.sleepFn(policy.baseDelayMs * 2 ** (attempt - 1));
    return false;
  }
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
  const policy = resolveRetryPolicy(options);

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    if (await attemptRemoval({attempt, directory, policy})) {
      return;
    }
  }
};
