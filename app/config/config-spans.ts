/** @file Bounded operation spans for configuration and keybindings work. */
/*
 * A span is one completed operation and one fixed-shape line. The vocabulary
 * is closed: an operation and an outcome can be named, but no path, command
 * identifier, or keybinding content can reach the sink through this module.
 */
import type {ObservabilitySink} from './config-observability';

/** The operations a span may describe. */
export type ConfigOperation = 'reload' | 'startup' | 'watcher-dispatch' | 'keybindings-read' | 'keybindings-write';

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
