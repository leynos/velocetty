/** @file The marker stream the end-to-end lane observes through. */
/*
 * The lane reads the application's standard output, so a printed line is its
 * only observation surface. Callers receive a sink rather than reaching for the
 * environment themselves: the composition root supplies the live stream, and a
 * caller with no stream to report to receives `silentMarkerSink`.
 */

/** The line sink the end-to-end lane's markers are written to. */
export type E2EMarkerSink = (line: string) => void;

/** Whether this process was started by the end-to-end lane. */
export const isE2ERun = (): boolean => process.env.RUN_E2E === '1';

/**
 * Writes a marker line only when the end-to-end lane is running.
 *
 * The marker stream is the lane's only observation surface: the test reads the
 * child process's standard output, so every assertion is a line printed here.
 *
 * @example
 * ```ts
 * emitE2EMarker('[e2e] renderer-ready'); // prints only under RUN_E2E=1
 * ```
 */
export const emitE2EMarker: E2EMarkerSink = (line: string): void => {
  if (isE2ERun()) {
    console.log(line);
  }
};

/**
 * A marker sink for callers that have no marker stream to report to.
 *
 * @example
 * ```ts
 * silentMarkerSink('[e2e] renderer-ready'); // prints nothing, whatever the lane flag says
 * ```
 */
export const silentMarkerSink: E2EMarkerSink = () => {};
