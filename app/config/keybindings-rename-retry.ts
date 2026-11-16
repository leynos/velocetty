/** @file Retry policy for renaming a temporary keybindings file into place. */
/*
 * Windows can refuse a rename while an editor or antivirus briefly holds the
 * destination. The policy is kept apart from the atomic-write adapter so the
 * retry rules can be read and tested without the filesystem work around them.
 */
import {errorCode} from '../utils/error-code';
import type {RenameFailureCategory, RenameRetryEvent} from './keybindings-store-contract';

/** Four gaps between five attempts, keeping retries within about 200ms. */
const RENAME_RETRY_DELAY_MS = 40;
const MAX_RENAME_ATTEMPTS = 5;
const TRANSIENT_RENAME_CODES: ReadonlySet<string> = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Maps an errno code onto the closed category vocabulary. */
const renameFailureCategory = (code: string | undefined): RenameFailureCategory => {
  if (code === 'EPERM' || code === 'EACCES') {
    return 'permission';
  }
  return code === 'EBUSY' ? 'busy' : 'other';
};

/** Blocks the calling thread; only used between transient Windows retries. */
const defaultSleep = (milliseconds: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

/** The rename operation and the hooks the retry policy reports through. */
export type RenameRetryDependencies = {
  readonly rename: (temporaryPath: string, target: string) => void;
  /** Called once per refused attempt so a caller can count and log it. */
  readonly onRetry?: ((event: RenameRetryEvent) => void) | undefined;
  readonly sleep?: ((milliseconds: number) => void) | undefined;
};

/**
 * Creates the rename-with-retry operation for one store.
 *
 * A transient failure is retried up to a fixed attempt count; any other errno
 * ends the operation at once. Every refusal is reported with a 1-based attempt
 * number and a bounded category, and the original error is thrown once the
 * retries are exhausted, so the caller still sees why the write failed.
 *
 * @example
 * ```ts
 * const rename = createRenameWithRetry({rename: (from, to) => fileSystem.renameSync(from, to)});
 * rename('keybindings.json5.1.0.tmp', 'keybindings.json5');
 * ```
 */
export const createRenameWithRetry =
  (dependencies: RenameRetryDependencies) =>
  (temporaryPath: string, target: string): void => {
    const sleep = dependencies.sleep ?? defaultSleep;
    for (let attempt = 1; ; attempt += 1) {
      try {
        dependencies.rename(temporaryPath, target);
        return;
      } catch (error) {
        const code = errorCode(error);
        const canRetry = code !== undefined && TRANSIENT_RENAME_CODES.has(code);
        const exhausted = !canRetry || attempt >= MAX_RENAME_ATTEMPTS;
        dependencies.onRetry?.({attempt, category: renameFailureCategory(code), exhausted});
        if (exhausted) {
          throw error;
        }
        sleep(RENAME_RETRY_DELAY_MS);
      }
    }
  };
