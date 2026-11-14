/** @file The channel the application reports end-to-end markers through. */
/*
 * Markers exist for the end-to-end lane, which observes the application
 * through its standard output. A unit that reports one should not have to know
 * whether this process is the lane, and the shipped build must print none of
 * them: so a unit reports to this channel, and the entry point that runs the
 * lane installs the sink. Until such an entry point installs one, the channel
 * discards every line.
 */
import {silentMarkerSink, type E2EMarkerSink} from './e2e-marker-sink';

/** The sink this process reports to; silent until an entry point installs one. */
let installedSink: E2EMarkerSink = silentMarkerSink;

/**
 * Installs the sink every marker is reported to.
 *
 * Called by the entry point that runs the end-to-end lane, before the
 * configuration is initialized, so start-up markers reach the lane's stream.
 * Passing `silentMarkerSink` restores the shipped build's behaviour.
 *
 * @param sink - Receives each marker line from now on.
 *
 * @example
 * ```ts
 * installMarkerSink(createMarkerSink(isLaneRunning, console.log));
 * reportMarker('[e2e] config-watcher-ready'); // printed only while the lane runs
 * ```
 */
export const installMarkerSink = (sink: E2EMarkerSink): void => {
  installedSink = sink;
};

/**
 * Reports one marker line, or discards it when no sink is installed.
 *
 * @param line - The complete marker line, including its `[e2e]` prefix.
 */
export const reportMarker: E2EMarkerSink = (line: string): void => {
  installedSink(line);
};
