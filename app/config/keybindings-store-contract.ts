/** @file Injected dependencies and bounded failure types for the keybindings store. */
/*
 * The adapter's option shape and its closed failure vocabulary live apart from
 * the atomic-write implementation. Keeping them here lets the observability
 * module name a retry event without importing the filesystem adapter, and it
 * keeps the adapter itself within the repository's file-size limit.
 */
import type {ConfigSpanRecorder} from './config-spans';
import type {KeybindingsReadOutcome} from './keybindings-ports';

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
  /** Called once per refused rename attempt, so a caller can count and log it. */
  readonly onRetry?: (event: RenameRetryEvent) => void;
  readonly sleep?: (milliseconds: number) => void;
  readonly spans?: ConfigSpanRecorder;
  readonly warn?: typeof console.warn;
};
