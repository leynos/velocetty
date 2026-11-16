/** @file Records one start-up import: the span it ran in and the record it emitted. */
/*
 * The composition root builds the adapters and applies the result; this module
 * owns what start-up reports about the one import it runs. The recorder and the
 * span recorder arrive as dependencies, so the exact record and span a session
 * emits can be asserted without Electron, a watcher, or a real file.
 */
import type {ConfigSpanRecorder} from './config-spans';
import type {ImportRecord, ImportRecorder} from './config-observability';
import type {ConfigSourceKind} from './import-report';
import {runStartupImport, type StartupImportDependencies, type StartupImportOutcome} from './startup-import';

/** The collaborators one start-up session drives and reports through. */
export type StartupSessionDependencies = Readonly<{
  /** Reads every watched file's identity before the import reads anything. */
  readonly captureStamps: StartupImportDependencies['captureStamps'];
  /** The tree that supplied the active configuration, named in the record. */
  readonly configSource: ConfigSourceKind;
  /** Runs the start-up import once. */
  readonly importConfiguration: StartupImportDependencies['importConfiguration'];
  /** Creates the configuration tree and clears a stale temporary file. */
  readonly prepare: StartupImportDependencies['prepare'];
  readonly recorder: ImportRecorder;
  /** Adopts the identity of each file the import wrote. */
  readonly settleStamps: StartupImportDependencies['settleStamps'];
  readonly spans: ConfigSpanRecorder;
}>;

/** What one start-up session produced, for the composition root to apply. */
export type StartupSession = StartupImportOutcome &
  Readonly<{
    /** The one record this session emitted. */
    readonly record: ImportRecord;
  }>;

/**
 * Runs the start-up import and reports its span and record.
 *
 * The attempt is counted before any preparation runs, so a failure while
 * creating the tree or clearing a stale temporary file is still a start-up
 * attempt. A thrown import produces the bounded failure record instead of a
 * decision record, because there is no per-file outcome to describe.
 *
 * @param dependencies - The import sequence and the sinks its outcome reaches.
 * @returns The import result, the baseline to watch from, and the record.
 *
 * @example
 * ```ts
 * const {imported, record, startupStamps} = runStartupSession({captureStamps, configSource, importConfiguration, prepare, recorder, settleStamps, spans});
 * record.announced; // false: start-up never shows "Configuration updated"
 * ```
 */
export const runStartupSession = (dependencies: StartupSessionDependencies): StartupSession => {
  const {captureStamps, configSource, importConfiguration, prepare, recorder, settleStamps, spans} = dependencies;
  const finishSpan = spans.begin('startup');
  let outcome: StartupImportOutcome;
  try {
    recorder.beginImport({phase: 'startup'});
    outcome = runStartupImport({captureStamps, importConfiguration, prepare, settleStamps});
  } catch (error) {
    // A start-up crash is otherwise invisible: no per-file outcome exists, so
    // it needs the same bounded failure record a thrown reload gets.
    finishSpan('thrown');
    recorder.recordImportFailure({cause: 'thrown', phase: 'startup'});
    throw error;
  }
  const {imported} = outcome;
  const {keybindings, report} = imported;
  finishSpan(report.config === 'fallback' ? 'fallback' : 'applied');
  const record: ImportRecord = {
    // Start-up never shows "Configuration updated", so the record states that
    // rather than leaving the field absent.
    announced: false,
    configSource,
    outcome: keybindings,
    phase: 'startup',
    report
  };
  if (report.config === 'fallback') {
    Object.assign(record, {fallbackBasis: 'defaults' as const});
  }
  recorder.recordImport(record);
  return {...outcome, record};
};
