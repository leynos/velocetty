/** @file Logs why the bundled defaults or the platform keymap could not be used. */
/*
 * Logging is kept apart from the read that discovers a fault, so the read-only
 * default query never reaches a sink. Start-up calls these functions once, at
 * the moment the application acts on the fault.
 */
import type {configValidationDiagnostic} from '@shared/types/config';
import type {ConfigFallbackCause} from './import-report';
import {reportDiagnostics} from './import-sources-parse';

/** The two fault logs the import emits, with their sinks already bound. */
export type ImportFaultLogging = {
  readonly reportDefaultConfigFault: (
    failure: ConfigFallbackCause | undefined,
    diagnostics: readonly configValidationDiagnostic[]
  ) => void;
  readonly reportPlatformKeymapFault: (
    failure: ConfigFallbackCause | undefined,
    diagnostics: readonly configValidationDiagnostic[]
  ) => void;
};

/** The log sinks a fault report may use; injected so a test can observe them. */
export type ImportFaultLoggingDependencies = {
  error: typeof console.error;
  warn: typeof console.warn;
};

/**
 * Creates the log lines that explain a bundled-file fault.
 *
 * The wording lives here rather than in the query, so the query stays silent
 * and the boundaries that act on a fault cannot describe it differently.
 *
 * @example
 * ```ts
 * const {reportDefaultConfigFault} = createImportFaultLogging({error, warn});
 * reportDefaultConfigFault('read', []); // logs the unreadable bundled file
 * ```
 */
export const createImportFaultLogging = (dependencies: ImportFaultLoggingDependencies): ImportFaultLogging => {
  const {error: errorFn, warn: warnFn} = dependencies;

  /**
   * Logs why the bundled default config fell back.
   *
   * Kept out of the read so the query stays silent; start-up calls this once.
   *
   * @example
   * ```ts
   * reportDefaultConfigFault('read', []); // logs the unreadable bundled file
   * ```
   */
  const reportDefaultConfigFault = (
    failure: ConfigFallbackCause | undefined,
    diagnostics: readonly configValidationDiagnostic[]
  ): void => {
    if (failure === 'read') {
      errorFn('[config-import] Failed to read the bundled default config. Using safe fallback defaults.');
      return;
    }
    reportDiagnostics(warnFn, 'Bundled default config diagnostics.', diagnostics);
    errorFn('[config-import] Failed to parse the bundled default config. Using safe fallback defaults.');
  };

  /**
   * Logs why the shipped platform keymap could not be used.
   *
   * @example
   * ```ts
   * reportPlatformKeymapFault('parse', diagnostics); // logs the bad keymap
   * ```
   */
  const reportPlatformKeymapFault = (
    failure: ConfigFallbackCause | undefined,
    diagnostics: readonly configValidationDiagnostic[]
  ): void => {
    if (failure === 'read') {
      errorFn('[config-import] Failed to read the platform keymap. Using no platform defaults.');
      return;
    }
    reportDiagnostics(warnFn, 'Platform keymap diagnostics.', diagnostics);
  };

  return {reportDefaultConfigFault, reportPlatformKeymapFault};
};
