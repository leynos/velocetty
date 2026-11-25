/** @file The start-up sequence shared by the production and lane entry points. */
import {app} from 'electron';

import {silentMarkerSink, type E2EMarkerSink} from './config/e2e-marker-sink.js';
import {describeError} from './utils/error-code.js';

/** What an entry point supplies to the shared start-up sequence. */
export type StartApplicationOptions = Readonly<{
  /**
   * Runs once the configuration is available and before the main process
   * modules load. The lane's entry point starts its instrumentation here; a
   * shipped build passes nothing.
   */
  readonly afterConfigurationSetup?: () => void;
  /**
   * Receives every marker this process reports.
   *
   * The entry point owns the decision, so no unit below it inspects the lane's
   * environment: both entry points select a sink from the lane flag, and a
   * launch outside the lane writes nothing.
   */
  readonly markerSink?: E2EMarkerSink;
}>;

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
 * @param options - The marker sink this process reports through, and the
 * instrumentation to run once the configuration is available.
 *
 * @example
 * ```ts
 * await startApplication(); // an ordinary launch, silent marker sink
 * ```
 */
export const startApplication = async ({
  afterConfigurationSetup,
  markerSink = silentMarkerSink
}: StartApplicationOptions = {}): Promise<void> => {
  try {
    const config = await import('./config.js');
    config.setup({markerSink});
    afterConfigurationSetup?.();

    // The main process takes the sink as an explicit argument, so the command
    // table and every window report through the sink this entry point chose
    // rather than through a channel the configuration root would have to hold.
    const {startMainProcess} = await import('./start.js');
    startMainProcess({markerSink});
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
