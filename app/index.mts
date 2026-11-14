/** @file Handles informational CLI arguments before starting Electron. */
import {app} from 'electron';

import packageMetadata from './package.json' with {type: 'json'};
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
  await startApplication();
}
