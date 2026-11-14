/** @file Injected dependencies and bounded failure types for the keybindings store. */
/*
 * The adapter's option shape and its closed failure vocabulary live apart from
 * the atomic-write implementation. Keeping them here lets the observability
 * module name a retry event without importing the filesystem adapter, and it
 * keeps the adapter itself within the repository's file-size limit.
 */
import type {ConfigMetrics} from './config-metrics';
import type {ConfigSpanRecorder} from './config-spans';
import type {KeybindingsReadOutcome, KeybindingsStorageFailure} from './keybindings-ports';

/** The errno codes with a dedicated port category; adding one is data, not a new disjunct. */
const STORAGE_FAILURES = new Map<string, KeybindingsStorageFailure>([
  ['EACCES', 'permission'],
  ['EPERM', 'permission'],
  ['EROFS', 'permission'],
  ['ENOENT', 'missing']
]);

/**
 * Maps a raw errno code onto the port's bounded failure vocabulary.
 *
 * The adapter keeps the raw error for its own decision, but every port outcome
 * and log field goes through this one mapping, so an errno the vocabulary does
 * not name cannot be reported as anything more specific than `other`.
 *
 * @example
 * ```ts
 * storageFailure('EACCES'); // 'permission'
 * storageFailure('EIO'); // 'other'
 * ```
 */
export const storageFailure = (code: string | undefined): KeybindingsStorageFailure =>
  (code === undefined ? undefined : STORAGE_FAILURES.get(code)) ?? 'other';

/**
 * A read result paired with the raw error the port deliberately hides.
 *
 * The adapter needs the error to warn with it, while the port exposes only a
 * bounded failure reason.
 */
export type RawRead = {
  readonly error?: unknown;
  readonly outcome: KeybindingsReadOutcome;
};

/** The filesystem subset the adapter uses; injected so tests can fail each step. */
export type KeybindingsFileSystem = Pick<
  typeof import('node:fs'),
  | 'accessSync'
  | 'constants'
  | 'realpathSync'
  | 'readFileSync'
  | 'openSync'
  | 'writeSync'
  | 'fsyncSync'
  | 'closeSync'
  | 'statSync'
  | 'lstatSync'
  | 'readlinkSync'
  | 'chmodSync'
  | 'renameSync'
  | 'unlinkSync'
  | 'readdirSync'
>;

/**
 * The bounded reason a rename was refused.
 *
 * The errno string itself is not reported: it is not a fixed vocabulary, and a
 * counter or log that accepts arbitrary text cannot be aggregated safely.
 */
export type RenameFailureCategory = 'permission' | 'busy' | 'other';

/** One refused rename attempt, and whether the store stopped retrying. */
export type RenameRetryEvent = {
  /** 1-based count of the attempt that was refused. */
  readonly attempt: number;
  readonly category: RenameFailureCategory;
  /** True when this refusal ended the retries, so the write failed. */
  readonly exhausted: boolean;
};

/** Every dependency the file adapter accepts. */
export type FileKeybindingsStoreOptions = {
  readonly filePath: string;
  readonly fs?: KeybindingsFileSystem;
  /**
   * Counts every failed write in the shared bounded vocabulary.
   *
   * Counting in the adapter rather than at a caller means a bootstrap write and
   * a public import are both measured, including the bootstrap case that the
   * service reports as `applied` with an unsaved origin.
   */
  readonly metrics?: ConfigMetrics;
  /** Called once per refused rename attempt, so a caller can count and log it. */
  readonly onRetry?: (event: RenameRetryEvent) => void;
  readonly sleep?: (milliseconds: number) => void;
  readonly spans?: ConfigSpanRecorder;
  readonly warn?: typeof console.warn;
};
