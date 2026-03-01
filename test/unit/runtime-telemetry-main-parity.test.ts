/** @file Guards parity between shared and main-process runtime telemetry constants. */
import {describe, expect, test} from 'bun:test';

import {
  LONG_FRAME_THRESHOLD_MS as appLongFrameThresholdMs,
  PTY_BATCH_DURATION_MS as appPtyBatchDurationMs,
  PTY_BATCH_MAX_BYTES as appPtyBatchMaxBytes,
  hasPtyBatchThresholdParity as appHasPtyBatchThresholdParity
} from '../../app/constants/runtime-telemetry';
import {
  LONG_FRAME_THRESHOLD_MS as sharedLongFrameThresholdMs,
  PTY_BATCH_DURATION_MS as sharedPtyBatchDurationMs,
  PTY_BATCH_MAX_BYTES as sharedPtyBatchMaxBytes,
  hasPtyBatchThresholdParity as sharedHasPtyBatchThresholdParity
} from '../../shared/src/constants/runtime-telemetry';

describe('main-process runtime telemetry parity', () => {
  test('keeps PTY batching constants aligned with shared runtime contract', () => {
    expect(appPtyBatchDurationMs).toBe(sharedPtyBatchDurationMs);
    expect(appPtyBatchMaxBytes).toBe(sharedPtyBatchMaxBytes);
    expect(appLongFrameThresholdMs).toBe(sharedLongFrameThresholdMs);
  });

  test('keeps PTY batching parity checks aligned with shared runtime contract', () => {
    expect(appHasPtyBatchThresholdParity()).toBe(sharedHasPtyBatchThresholdParity());
  });
});
