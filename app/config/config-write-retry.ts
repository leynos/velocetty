/**
 * @file Retry policy and reporting for the single config writer.
 *
 * The writer's critical section survives a transient file-system refusal by
 * re-running the whole attempt. This module owns what a failure means, when
 * another attempt is allowed, and the bounded counters and lines a retry and a
 * final failure emit, so the critical section itself reads as one decision per
 * attempt.
 */
import type {ConfigMetrics} from './config-metrics';
import {boundedErrorCode, describeError, errorCode} from '../utils/error-code';

/** How many attempts one edit may take, including the first. */
export const MAX_ATTEMPTS = 3;

/** The errnos a second attempt can clear: a file another process still holds. */
const RETRYABLE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

/** What one failed attempt means for the caller. */
export type WriteFailureKind = 'missing' | 'retry' | 'failed';

/**
 * Decides whether a failed attempt may be retried.
 *
 * @param code - The error code, when the failure carried one.
 * @param attempt - The one-based number of the attempt that just failed.
 * @returns True when another attempt is both safe and available.
 */
const shouldRetry = (code: string | undefined, attempt: number): boolean =>
  code !== undefined && RETRYABLE_CODES.has(code) && attempt < MAX_ATTEMPTS;

/**
 * Classifies one failed attempt.
 *
 * @param error - Whatever the attempt threw.
 * @param attempt - The one-based number of the attempt that just failed.
 * @returns `missing` for ENOENT, `retry` when another attempt is allowed, and
 * `failed` otherwise.
 */
export const classifyWriteFailure = (error: unknown, attempt: number): WriteFailureKind => {
  const code = errorCode(error);
  if (code === 'ENOENT') {
    return 'missing';
  }
  return shouldRetry(code, attempt) ? 'retry' : 'failed';
};

/** The dependencies a retry reports through. */
type RetryReporter = {
  readonly metrics?: Pick<ConfigMetrics, 'increment'>;
  readonly log: (message: string) => void;
  readonly sleep: (milliseconds: number) => Promise<void>;
};

/**
 * Counts one retried attempt, logs its bounded line, and waits its backoff.
 *
 * @param dependencies - The writer's counters, line sink, and clock.
 * @param error - The failure that will be retried.
 * @param attempt - The one-based number of the attempt that just failed.
 */
export const recordRetry = async (dependencies: RetryReporter, error: unknown, attempt: number): Promise<void> => {
  dependencies.metrics?.increment('settingsWriteRetries');
  // Only the errno and the attempt number: a key, a path, and the text are user data.
  dependencies.log(`config writer retry attempt=${attempt} code=${boundedErrorCode(error) ?? 'unknown'}`);
  await dependencies.sleep(attempt * 50);
};

/**
 * Logs the bounded failure that ended the write.
 *
 * @param dependencies - The writer's line sink.
 * @param error - The failure that ended the write.
 */
export const recordFailure = (dependencies: Pick<RetryReporter, 'log'>, error: unknown): void => {
  dependencies.log(`config writer failed: ${JSON.stringify(describeError(error))}`);
};
