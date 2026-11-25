/** @file Starts the application with the end-to-end lane's instrumentation. */
/*
 * The lane observes the application through its standard output and presses key
 * chords by appending them to a request file. Both channels are decided here, in
 * the entry point that only the lane starts, so the units below it never inspect
 * the lane's environment. The shipped entry point selects the same marker sink
 * from the same flag, because the packaged build is what the lane packages; only
 * this entry point starts the shortcut probe and reads a request file.
 */
import {createMarkerSink} from './config/e2e-marker-sink.js';
import {startShortcutProbe} from './config/e2e-shortcut-probe.js';
import {startApplication} from './startup.mjs';

/** Whether this process is the end-to-end lane. */
const isLaneRunning = (): boolean => process.env.RUN_E2E === '1';

// Built before start-up runs, because the composition root reports the
// configuration paths it resolved while it initializes.
const markerSink = createMarkerSink(isLaneRunning, (line) => console.log(line));

await startApplication({
  markerSink,
  afterConfigurationSetup: () => {
    // Dormant outside the lane: the probe arms only when the flag is set, and
    // reads requests only from the file this entry point names.
    startShortcutProbe({
      isLaneRunning: isLaneRunning(),
      marker: markerSink,
      requestFile: process.env.VELOCETTY_E2E_PRESS_FILE
    });
  }
});
