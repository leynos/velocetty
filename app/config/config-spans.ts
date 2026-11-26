/** @file Bounded operation spans for configuration and keybindings work. */
/*
 * A span is one completed operation and one fixed-shape line. The vocabulary
 * is closed: an operation and an outcome can be named, but no path, command
 * identifier, or keybinding content can reach the sink through this module.
 */
import type {SettingsWriteFailure, SettingsWriteOutcome} from '@shared/settings/protocol';

import type {ConfigMetrics} from './config-metrics';
import type {ObservabilitySink} from './config-observability';

/** The operations a span may describe. */
export type ConfigOperation =
  | 'reload'
  | 'startup'
  | 'watcher-dispatch'
  | 'keybindings-read'
  | 'keybindings-write'
  | 'settings-write';

/** The ways an operation may finish. */
export type ConfigSpanOutcome =
  | 'applied'
  | 'fallback'
  | 'thrown'
  | 'present'
  | 'missing'
  | 'unreadable'
  | 'written'
  | 'failed';

/** Starts one operation and returns the callback that completes it. */
export type ConfigSpanRecorder = {
  readonly begin: (operation: ConfigOperation) => (outcome: ConfigSpanOutcome) => void;
};

/** The bounded hooks a settings write reports through; every one is optional. */
export type SettingsWriteObserver = {
  readonly spans?: ConfigSpanRecorder;
  readonly metrics?: Pick<ConfigMetrics, 'increment'>;
  readonly log?: (message: string) => void;
};

/** The protocol reason a rejected edit carries: the value cannot be written there. */
const REJECTED_REASON: SettingsWriteFailure = 'not-editable';

/** A write that was not applied; its kind names which non-apply counter to bump. */
type RefusedOutcome = Exclude<SettingsWriteOutcome, {readonly kind: 'applied'}>;

/** The counter one refused outcome increments. */
const refusalCounter = (outcome: RefusedOutcome): 'settingsRejections' | 'settingsFailures' =>
  outcome.kind === 'rejected' ? 'settingsRejections' : 'settingsFailures';

/** The closed-vocabulary reason one refused outcome logs. */
const refusalReason = (outcome: RefusedOutcome): SettingsWriteFailure =>
  outcome.kind === 'rejected' ? REJECTED_REASON : outcome.reason;

/** Counts and, for a refusal, logs one completed write. */
const recordOutcome = (observer: SettingsWriteObserver, outcome: SettingsWriteOutcome): void => {
  if (outcome.kind === 'applied') {
    observer.metrics?.increment('settingsApplies');
    return;
  }
  observer.metrics?.increment(refusalCounter(outcome));
  observer.log?.(`settings write refused reason=${refusalReason(outcome)}`);
};

/** Records a write that threw instead of returning an outcome. */
const recordFailure = (observer: SettingsWriteObserver): void => {
  observer.metrics?.increment('settingsFailures');
  observer.log?.('settings write refused reason=io-error');
};

/** A span finisher for an observer with no recorder, so the write still completes. */
const NO_OP_SPAN = (): void => {};

/**
 * Runs one settings write and records its bounded outcome.
 *
 * The span is opened before the write runs and finished `applied` or `failed`.
 * The counter separates the three outcome kinds, and a non-applied outcome
 * emits one line whose reason comes from the protocol's closed vocabulary,
 * never a key, a path, file content, or a raw error message. An unexpected
 * throw is still counted and spanned, then rethrown, so a caller's failure
 * handling is unchanged.
 *
 * @example
 * ```ts
 * const outcome = await observeSettingsWrite(observer, () => service.setValue(target, 16));
 * outcome.kind; // 'applied'
 * ```
 */
export const observeSettingsWrite = async (
  observer: SettingsWriteObserver,
  write: () => Promise<SettingsWriteOutcome>
): Promise<SettingsWriteOutcome> => {
  const finishSpan = observer.spans?.begin('settings-write') ?? NO_OP_SPAN;
  try {
    const outcome = await write();
    finishSpan(outcome.kind === 'applied' ? 'applied' : 'failed');
    recordOutcome(observer, outcome);
    return outcome;
  } catch (error) {
    finishSpan('failed');
    recordFailure(observer);
    throw error;
  }
};

/**
 * Creates the span recorder for one process.
 *
 * `begin` captures the clock; the returned callback emits exactly one line
 * with the rounded, non-negative elapsed time. The clock and sink are injected
 * so a test can assert the exact text without timing the real process.
 *
 * @example
 * ```ts
 * const lines: string[] = [];
 * const spans = createConfigSpanRecorder({
 *   now: () => 1000,
 *   sink: {info: (line) => lines.push(line), warn: () => {}}
 * });
 * spans.begin('reload')('applied');
 * lines; // ['[config] span operation=reload outcome=applied ms=0']
 * ```
 */
export const createConfigSpanRecorder = (dependencies: {
  readonly sink: ObservabilitySink;
  readonly now: () => number;
}): ConfigSpanRecorder => {
  const {sink, now} = dependencies;

  return {
    begin: (operation) => {
      const startedAt = now();
      return (outcome) => {
        const elapsed = Math.max(0, Math.round(now() - startedAt));
        sink.info(`[config] span operation=${operation} outcome=${outcome} ms=${elapsed}`);
      };
    }
  };
};
