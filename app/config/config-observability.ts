/** @file The one bounded record and counter update for each import attempt. */
/*
 * Recording lives here rather than in the composition root so the exact record
 * a session emits can be tested without Electron. The sink is injected, and
 * every field comes from a closed vocabulary: a record can state which phase
 * ran, which file fell back, and which keybindings outcome held, but it cannot
 * carry a path, a command identifier, or a shortcut.
 */
import {describeConfigCounters, type ConfigCounters, type ConfigMetrics} from './config-metrics';
import {describeImportDecision, type ConfigImportReport} from './import-report';
import type {KeybindingsLoadOutcome} from './keybindings';
import type {RenameRetryEvent} from './keybindings-store';

/** Where bounded records go; injected so a test can capture them. */
export type ObservabilitySink = {
  readonly info: (line: string) => void;
  readonly warn: (line: string) => void;
};

/** One import attempt, as the composition root observed it. */
export type ImportRecord = {
  readonly phase: 'reload' | 'startup';
  /** The per-file summary, whose `config` half the counters use. */
  readonly report: ConfigImportReport;
  /** The keybindings outcome, passed through so `origin`/`basis`/`cause` survive. */
  readonly outcome: KeybindingsLoadOutcome;
  /** Whether the "Configuration updated" notice was shown. */
  readonly announced: boolean;
};

/** The recorder the composition root wires into the importer and the store. */
export type ImportRecorder = {
  /** Counts one attempt and emits its single decision record. */
  readonly recordImport: (record: ImportRecord) => void;
  /** Counts one refused rename attempt and emits its bounded record. */
  readonly recordRenameRetry: (event: RenameRetryEvent) => void;
  /** The cumulative counters, for diagnostics and tests. */
  readonly counters: () => ConfigCounters;
};

/** Counts what the keybindings outcome says happened, in its own vocabulary. */
const countKeybindingsOutcome = (metrics: ConfigMetrics, outcome: KeybindingsLoadOutcome): void => {
  if (outcome.kind === 'applied') {
    metrics.increment('applies');
    return;
  }
  if (outcome.cause === 'invalid') {
    metrics.increment('parseFailures');
  } else if (outcome.cause === 'unreadable') {
    metrics.increment('readFailures');
  }
};

/**
 * Creates the recorder for one process.
 *
 * @example
 * ```ts
 * const lines: string[] = [];
 * const recorder = createImportRecorder({
 *   metrics: createConfigMetrics(),
 *   sink: {info: (line) => lines.push(line), warn: () => {}}
 * });
 * recorder.recordRenameRetry({attempt: 1, category: 'busy', exhausted: false});
 * recorder.counters().retries; // 1
 * ```
 */
export const createImportRecorder = (dependencies: {
  readonly metrics: ConfigMetrics;
  readonly sink: ObservabilitySink;
}): ImportRecorder => {
  const {metrics, sink} = dependencies;

  return {
    counters: () => metrics.snapshot(),
    recordImport: ({phase, report, outcome, announced}) => {
      metrics.increment('attempts');
      if (report.config === 'fallback') {
        metrics.increment('fallbacks');
      }
      countKeybindingsOutcome(metrics, outcome);
      const decision = describeImportDecision({announced, config: report.config, keybindings: outcome, phase});
      sink.info(`[config] import decision ${decision} ${describeConfigCounters(metrics.snapshot())}`);
    },
    recordRenameRetry: (event) => {
      metrics.increment('retries');
      sink.warn(
        `[config] keybindings rename attempt=${event.attempt} category=${event.category} exhausted=${event.exhausted}`
      );
    }
  };
};
