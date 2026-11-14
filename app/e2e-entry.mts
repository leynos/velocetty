/** @file Starts the application with the end-to-end lane's instrumentation. */
/*
 * The lane observes the application through its standard output and presses key
 * chords by appending them to a request file. Both channels are decided here, in
 * the entry point that only the lane starts, so the shipped entry point and the
 * units it loads never inspect the lane's environment: a normal launch installs
 * no sink and reads no request file.
 */
import {createMarkerSink} from './config/e2e-marker-sink.js';
import {startShortcutProbe} from './config/e2e-shortcut-probe.js';
import {installMarkerSink, reportMarker} from './config/marker-channel.js';
import {startApplication} from './startup.mjs';

/** Whether this process is the end-to-end lane. */
const isLaneRunning = (): boolean => process.env.RUN_E2E === '1';

// Installed before start-up runs, because the composition root reports the
// configuration paths it resolved while it initializes.
installMarkerSink(createMarkerSink(isLaneRunning, (line) => console.log(line)));

await startApplication(() => {
  // Dormant outside the lane: the probe arms only when the flag is set, and
  // reads requests only from the file this entry point names.
  startShortcutProbe({
    isLaneRunning: isLaneRunning(),
    marker: reportMarker,
    requestFile: process.env.VELOCETTY_E2E_PRESS_FILE
  });
});
