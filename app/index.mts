/** @file Handles informational CLI arguments, then starts Electron with the sink the lane flag selects. */
import {app} from 'electron';

import packageMetadata from './package.json' with {type: 'json'};
import {createMarkerSink} from './config/e2e-marker-sink.js';
import {cfgPath, configTree, keybindingsPath} from './config/paths.js';
import {startApplication} from './startup.mjs';

const informationalArguments = ['--help', '-v', '--version'];
const requestedArgument = process.argv[1];

if (requestedArgument && informationalArguments.includes(requestedArgument)) {
  console.log(`Hyper version ${packageMetadata.version}`);
  console.log('Hyper does not accept any command line arguments. Please modify the config file instead.');
  console.log(`Hyper configuration file located at: ${cfgPath}`);
  console.log(`Hyper keybindings file located at: ${keybindingsPath}`);
  console.log(`Hyper configuration tree in use: ${configTree}`);
  app.quit();
} else {
  // The packaged build is itself what the end-to-end lane launches, so this
  // entry point chooses the sink on the lane's flag rather than leaving it
  // silent: a marker written to standard output is the only evidence the lane
  // can collect from a packaged run. Every other launch discards the lines, so
  // an ordinary user's terminal sees nothing.
  const markerSink = createMarkerSink(
    () => process.env.RUN_E2E === '1',
    (line) => console.log(line)
  );
  await startApplication({markerSink});
}
