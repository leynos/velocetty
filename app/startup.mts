/** @file The start-up sequence shared by the production and lane entry points. */
import {app} from 'electron';

import {describeError} from './utils/error-code.js';

/**
 * Initializes the configuration, then loads the main process modules.
 *
 * Configuration must be initialized before `./start.js` is imported. Node
 * evaluates a required module as soon as it is required, and several modules in
 * the tree below read the configuration while their own module body runs:
 * `./plugins` resolves the plugin and local-plugin lists, and `./session` reads
 * `useConpty`. Doing it here, inside the shared sequence, keeps that ordering
 * explicit instead of depending on where an import happens to sit relative to a
 * statement in a lower module.
 *
 * @param afterConfigurationSetup - Runs once the configuration is available and
 * before the main process modules load. The lane's entry point starts its
 * instrumentation here; a shipped build passes nothing.
 *
 * @example
 * ```ts
 * await startApplication(); // an ordinary launch
 * ```
 */
export const startApplication = async (afterConfigurationSetup?: () => void): Promise<void> => {
  try {
    const config = await import('./config.js');
    config.setup();
    afterConfigurationSetup?.();

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
};
