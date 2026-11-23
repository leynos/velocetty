/** @file Observability wrapper for the keybindings file store. */
/*
 * The atomic-write adapter knows what failed and why, but not how a failure is
 * reported. This module turns its bounded results into spans, warnings, and the
 * write-failure counter, so the adapter can stay free of sinks and the port can
 * stay free of raw errors.
 */
import type {ConfigMetrics} from './config-metrics';
import type {ConfigSpanRecorder} from './config-spans';
import type {
  KeybindingsReadOutcome,
  KeybindingsStorageFailure,
  KeybindingsStore,
  KeybindingsWriteOutcome
} from './keybindings-ports';
import type {RawRead} from './keybindings-store-contract';

/**
 * The bounded reason a write attempt should be logged against.
 *
 * The message differs by route — resolving the target, refusing a read-only
 * target, or failing during the commit — while the raw error never leaves the
 * adapter.
 */
export type KeybindingsWriteWarning =
  | {readonly failure: KeybindingsStorageFailure; readonly kind: 'unresolved-target'}
  | {readonly kind: 'read-only-target'}
  | {readonly failure: KeybindingsStorageFailure; readonly kind: 'commit-failed'};

/** What the adapter returns after a write: the port outcome and any warning. */
export type KeybindingsWriteAttempt = Readonly<{
  readonly outcome: KeybindingsWriteOutcome;
  readonly warning?: KeybindingsWriteWarning | undefined;
}>;

/** The bounded reason a stale-temporary-file cleanup should be logged against. */
export type KeybindingsCleanupWarning =
  | {readonly failure: KeybindingsStorageFailure; readonly kind: 'unresolved-target'}
  | {readonly failure: KeybindingsStorageFailure; readonly kind: 'directory-inspection'}
  | {readonly failure: KeybindingsStorageFailure; readonly kind: 'remove-stale-temporary'};

/**
 * The silent filesystem operations the reporting wrapper observes.
 *
 * `readRaw` keeps the raw error the port hides, while cleanup returns its
 * warnings rather than emitting them, so the adapter never holds a sink.
 */
export type AtomicKeybindingsStore = {
  readonly readRaw: () => RawRead;
  readonly removeStaleTemporaryFiles: () => readonly KeybindingsCleanupWarning[];
  readonly write: (text: string) => KeybindingsWriteAttempt;
};

/** Everything the wrapper needs to report, with the file name rather than a path. */
export type KeybindingsReportingDependencies = {
  readonly label: string;
  readonly metrics?: ConfigMetrics | undefined;
  readonly spans?: ConfigSpanRecorder | undefined;
  readonly warn?: typeof console.warn | undefined;
};

/**
 * Wraps a store so every service operation is measured and logged once.
 *
 * `peek()` is deliberately a plain read: export is a query over what is stored,
 * not a service operation, so it must not add noise to the read telemetry.
 *
 * @example
 * ```ts
 * const store = withReporting(adapter, {label: 'keybindings.json5', warn: console.warn});
 * store.peek(); // reads without a span or a warning
 * ```
 */
export const withReporting = (
  store: AtomicKeybindingsStore,
  dependencies: KeybindingsReportingDependencies
): KeybindingsStore & {readonly removeStaleTemporaryFiles: () => void} => {
  const {label, metrics, spans} = dependencies;
  const warnFn = dependencies.warn ?? console.warn;

  /** Logs one refused write with the wording its route owns. */
  const reportWriteWarning = (warning: KeybindingsWriteWarning): void => {
    if (warning.kind === 'unresolved-target') {
      warnFn(`[config-keybindings] Couldn't resolve ${label} for writing.`, {failure: warning.failure});
      return;
    }
    if (warning.kind === 'read-only-target') {
      // The synthetic refusal is logged for diagnosis; the port sees the category.
      warnFn(`[config-keybindings] Refused to replace read-only file ${label}.`);
      return;
    }
    warnFn(`[config-keybindings] Couldn't write ${label}.`, {failure: warning.failure});
  };

  /** Logs one failed stale-temporary-file cleanup step. */
  const reportCleanupWarning = (warning: KeybindingsCleanupWarning): void => {
    if (warning.kind === 'unresolved-target') {
      warnFn(`[config-keybindings] Couldn't resolve ${label} to inspect it for stale temporary files.`, {
        failure: warning.failure
      });
      return;
    }
    if (warning.kind === 'directory-inspection') {
      warnFn(`[config-keybindings] Couldn't inspect the keybindings directory for stale temporary files.`, {
        failure: warning.failure
      });
      return;
    }
    warnFn("[config-keybindings] Couldn't remove a stale temporary file.", {failure: warning.failure});
  };

  /**
   * Counts one failed write, then hands the outcome back unchanged.
   *
   * Both failure routes — a refused target and a failed commit — pass through
   * here, so a caller that only sees `kind: 'failed'` still contributes to the
   * write-failure tally, and the reason stays in the port's own vocabulary.
   */
  const countWriteOutcome = (outcome: KeybindingsWriteOutcome): KeybindingsWriteOutcome => {
    if (outcome.kind === 'failed') {
      metrics?.increment('writeFailures');
    }
    return outcome;
  };

  /** Reads the file for the service, recording a span and warning on failure. */
  const read = (): KeybindingsReadOutcome => {
    const finishSpan = spans?.begin('keybindings-read');
    const {outcome} = store.readRaw();
    // The port keeps only a bounded reason, and so does the log: the file name
    // is enough to locate the failure, while the raw error can carry a path or
    // a fragment of the file.
    if (outcome.kind === 'unreadable') {
      warnFn(`[config-keybindings] Couldn't read ${label}.`, {failure: outcome.failure});
    }
    finishSpan?.(outcome.kind);
    return outcome;
  };

  /**
   * Writes the document, reporting the attempt before the span closes.
   *
   * The warning is emitted first so a refused write is logged even though the
   * span and counter still report the same bounded outcome.
   */
  const write = (text: string): KeybindingsWriteOutcome => {
    const finishSpan = spans?.begin('keybindings-write');
    const attempt = store.write(text);
    if (attempt.warning !== undefined) {
      reportWriteWarning(attempt.warning);
    }
    finishSpan?.(attempt.outcome.kind === 'written' ? 'written' : 'failed');
    return countWriteOutcome(attempt.outcome);
  };

  /** Removes stale temporary files, reporting each failed step in order. */
  const removeStaleTemporaryFiles = (): void => {
    for (const warning of store.removeStaleTemporaryFiles()) {
      reportCleanupWarning(warning);
    }
  };

  return {label, peek: () => store.readRaw().outcome, read, removeStaleTemporaryFiles, write};
};
