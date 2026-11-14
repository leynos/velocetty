/** @file The `window:new` handler, with its window opener supplied by the caller. */
/*
 * `app/commands.ts` evaluates its table against Electron while its own module
 * body runs, so a unit test cannot import it to reach one handler. The handler
 * lives here instead and takes the window opener as a parameter: the table
 * passes Electron's opener, and a test passes a stand-in and observes the
 * marker channel on its own.
 */
import {formatCommandExecutedMarker} from '../config/e2e-keymap-probe';
import {reportMarker} from '../config/marker-channel';

/**
 * Builds the handler that opens a new window.
 *
 * @param openWindow - Opens the window; supplied by the caller so the handler
 * can be exercised without Electron.
 *
 * @example
 * ```ts
 * const handler = createWindowNewHandler(() => app.createWindow());
 * handler(); // reports `[e2e] command-executed window:new`, then opens a window
 * ```
 */
export const createWindowNewHandler =
  (openWindow: () => void): (() => void) =>
  (): void => {
    // The end-to-end lane asserts on the command having run, so the marker
    // belongs to the handler rather than to the configuration that bound it.
    // It carries the press's token, so a scenario can tell this press's
    // execution from an earlier press's command landing late. It goes to the
    // marker channel, whose sink only the lane's entry point installs, so a
    // shipped build has nothing to print to.
    reportMarker(formatCommandExecutedMarker('window:new'));
    // A window created on the same tick would consume the triggering event, so
    // the opener waits until the event has been delivered.
    setTimeout(openWindow, 0);
  };
