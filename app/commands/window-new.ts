/** @file The `window:new` handler, with its window opener and marker sink supplied by the caller. */
/*
 * The handler takes both collaborators as parameters, so it can be exercised
 * without Electron and without a process-wide channel. The command table
 * supplies the opener the composition root wired, and the sink the entry point
 * chose: outside the lane that sink writes nothing, and inside it every mark it
 * receives reaches the lane's stream.
 */
import {formatCommandExecutedMarker} from '../config/e2e-keymap-probe';
import type {E2EMarkerSink} from '../config/e2e-marker-sink';

/**
 * Builds the handler that opens a new window.
 *
 * @param openWindow - Opens the window; supplied by the caller so the handler
 * can be exercised without Electron.
 * @param markerSink - Receives the marker line describing the execution; the
 * caller's own sink decides whether the line is written anywhere.
 *
 * @example
 * ```ts
 * const handler = createWindowNewHandler(() => app.createWindow(), silentMarkerSink);
 * handler(); // reports `[e2e] command-executed window:new` to the sink, then opens a window
 * ```
 */
export const createWindowNewHandler =
  (openWindow: () => void, markerSink: E2EMarkerSink): (() => void) =>
  (): void => {
    // The end-to-end lane asserts on the command having run, so the marker
    // belongs to the handler rather than to the configuration that bound it.
    // It carries the press's token, so a scenario can tell this press's
    // execution from an earlier press's command landing late.
    markerSink(formatCommandExecutedMarker('window:new'));
    // A window created on the same tick would consume the triggering event, so
    // the opener waits until the event has been delivered.
    setTimeout(openWindow, 0);
  };
