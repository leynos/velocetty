/** @file The marker stream the end-to-end lane observes through. */
/*
 * The lane reads the application's standard output, so a printed line is its
 * only observation surface. This module builds a sink rather than reading the
 * lane's environment: the composition root decides whether this process is the
 * lane and which stream the lines go to, so a module that reports a marker
 * never has to know how the decision is made. A caller with no stream to
 * report to receives `silentMarkerSink`.
 */

/** The line sink the end-to-end lane's markers are written to. */
export type E2EMarkerSink = (line: string) => void;

/** A marker sink for callers that have no marker stream to report to. */
export const silentMarkerSink: E2EMarkerSink = () => {};

/**
 * Builds the marker sink for this process.
 *
 * The lane flag is read per line rather than once, so a test that starts the
 * lane after loading the composition root still observes its markers.
 *
 * @param isLaneRunning - Whether the end-to-end lane is running this process.
 * @param write - Receives each marker line while the lane is running.
 * @returns A sink that writes under the lane and discards every line otherwise.
 *
 * @example
 * ```ts
 * const sink = createMarkerSink(isE2ERun, (line) => console.log(line));
 * sink('[e2e] renderer-ready'); // prints only while the lane is running
 * ```
 */
export const createMarkerSink = (isLaneRunning: () => boolean, write: (line: string) => void): E2EMarkerSink => {
  return (line: string): void => {
    if (isLaneRunning()) {
      write(line);
    }
  };
};
