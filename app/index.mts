/** @file Handles informational CLI arguments before starting Electron. */
import {app} from 'electron';

import packageMetadata from './package.json' with {type: 'json'};
import {startShortcutProbe} from './config/e2e-shortcut-probe.js';
import {cfgPath, configTree, keybindingsPath} from './config/paths.js';
import {describeError} from './utils/error-code.js';

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
  try {
    // Configuration must be initialized before `./start.js` is imported.
    // Node evaluates a required module as soon as it is required, and several
    // modules in the tree below read the configuration while their own module
    // body runs: `./plugins` resolves the plugin and local-plugin lists, and
    // `./session` reads `useConpty`. Doing it here, at the entry point, keeps
    // that ordering explicit instead of depending on where an import happens
    // to sit relative to a statement in a lower module.
    const config = await import('./config.js');
    config.setup();
    // Dormant outside the end-to-end lane: the probe reads requests only when
    // `RUN_E2E=1`, and only from the file `VELOCETTY_E2E_PRESS_FILE` names.
    startShortcutProbe();

    await import('./start.js');
  } catch (error) {
    // The bounded description keeps a failed start-up diagnosable without
    // repeating a path or a secret the error message may quote. The stage and
    // category are fixed tokens, so support can tell a start-up failure from
    // the same error reported elsewhere.
    console.error('Failed to start Hyper.', {
      ...describeError(error),
      category: 'thrown',
      operation: 'startup'
    });
    process.exitCode = 1;
    app.quit();
  }
}
