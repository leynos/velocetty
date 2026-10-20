/** @file Handles informational CLI arguments before starting Electron. */
import {app} from 'electron';

import packageMetadata from './package.json' with {type: 'json'};
import {cfgPath} from './config/paths.js';

const informationalArguments = ['--help', '-v', '--version'];
const requestedArgument = process.argv[1];

if (requestedArgument && informationalArguments.includes(requestedArgument)) {
  console.log(`Hyper version ${packageMetadata.version}`);
  console.log('Hyper does not accept any command line arguments. Please modify the config file instead.');
  console.log(`Hyper configuration file located at: ${cfgPath}`);
  app.quit();
} else {
  try {
    await import('./start.js');
  } catch (error) {
    console.error('Failed to start Hyper.', error);
    process.exitCode = 1;
    app.quit();
  }
}
