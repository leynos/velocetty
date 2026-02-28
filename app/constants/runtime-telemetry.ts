/** @file Main-process runtime telemetry constants used by packaged app modules. */

/** PTY output batching interval in milliseconds. */
export const PTY_BATCH_DURATION_MS = 16;
/** PTY output batching ceiling in bytes (200KB). */
export const PTY_BATCH_MAX_BYTES = 200 * 1024;
/** Canonical PTY batching interval expected by roadmap 2.2.2. */
export const PTY_BATCH_EXPECTED_DURATION_MS = 16;
/** Canonical PTY batching ceiling expected by roadmap 2.2.2. */
export const PTY_BATCH_EXPECTED_MAX_BYTES = 200 * 1024;

/** Long-frame threshold used by renderer frame-timing instrumentation. */
export const LONG_FRAME_THRESHOLD_MS = 16;

/** Returns true when the configured PTY batching thresholds match canonical values. */
export const hasPtyBatchThresholdParity = () =>
  PTY_BATCH_DURATION_MS === PTY_BATCH_EXPECTED_DURATION_MS && PTY_BATCH_MAX_BYTES === PTY_BATCH_EXPECTED_MAX_BYTES;
