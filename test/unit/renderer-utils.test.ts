/** @file Verifies renderer tracking helpers and fallback reason counters. */
import {beforeEach, describe, expect, test} from 'bun:test';
import {asRendererUid} from '@shared/types/common';
import type {RendererRuntimeMetrics} from '@shared/types/common';

import {
  getAggregatedInputSendToWriteLatencyMetrics,
  getAggregatedRendererRuntimeMetrics,
  getInputSendToWriteLatencyByUid,
  getPtyBatchingThresholdMetrics,
  getRendererFallbackReasonCounts,
  getRendererRuntimeMetricsByUid,
  getRendererTypes,
  getRendererWebGLContextCounts,
  recordInputSendToWriteLatency,
  resetRendererTracking,
  setRendererRuntimeMetrics,
  setRendererType,
  unsetRendererType
} from '../../app/utils/renderer-utils';
import {PTY_BATCH_DURATION_MS, PTY_BATCH_MAX_BYTES} from '../../app/constants/runtime-telemetry';

beforeEach(() => {
  resetRendererTracking();
});

describe('renderer-utils', () => {
  const createRuntimeMetrics = ({
    inputSampleCount = 0,
    inputTotalMs = 0,
    inputMaxMs = 0,
    inputLastMs = 0,
    frameSampleCount = 0,
    frameTotalMs = 0,
    frameMaxMs = 0,
    frameLastMs = 0,
    longFrameCount = 0,
    longFrameThresholdMs = 16,
    reportIntervalMs = 1000,
    updatedAtMs = 0
  }: {
    inputSampleCount?: number;
    inputTotalMs?: number;
    inputMaxMs?: number;
    inputLastMs?: number;
    frameSampleCount?: number;
    frameTotalMs?: number;
    frameMaxMs?: number;
    frameLastMs?: number;
    longFrameCount?: number;
    longFrameThresholdMs?: number;
    reportIntervalMs?: number;
    updatedAtMs?: number;
  } = {}): RendererRuntimeMetrics => ({
    inputKeydownToSend: {
      sampleCount: inputSampleCount,
      totalMs: inputTotalMs,
      maxMs: inputMaxMs,
      lastMs: inputLastMs
    },
    frameTiming: {
      sampleCount: frameSampleCount,
      totalMs: frameTotalMs,
      maxMs: frameMaxMs,
      lastMs: frameLastMs,
      longFrameCount,
      longFrameThresholdMs
    },
    reportIntervalMs,
    updatedAtMs
  });

  describe('resetRendererTracking', () => {
    test('clears all tracked renderer metrics', () => {
      const uid = asRendererUid('uid-1');
      const additionalUid = asRendererUid('uid-2');

      setRendererType(asRendererUid('uid-1'), 'WebGL');
      setRendererType(additionalUid, 'Canvas', 'context-loss');
      setRendererType(asRendererUid('uid-3'), 'WebGL');
      setRendererRuntimeMetrics(
        uid,
        createRuntimeMetrics({inputSampleCount: 1, inputTotalMs: 5, inputMaxMs: 5, inputLastMs: 5})
      );
      recordInputSendToWriteLatency(uid, 5);

      expect(getRendererTypes()).toEqual({
        'uid-1': 'WebGL',
        'uid-2': 'Canvas',
        'uid-3': 'WebGL'
      });
      expect(getRendererFallbackReasonCounts()).toEqual({
        'context-loss': 1
      });
      expect(getRendererWebGLContextCounts()).toEqual({
        current: 2,
        peak: 2
      });
      expect(getRendererRuntimeMetricsByUid()).toEqual({
        'uid-1': createRuntimeMetrics({inputSampleCount: 1, inputTotalMs: 5, inputMaxMs: 5, inputLastMs: 5})
      });
      expect(getInputSendToWriteLatencyByUid()).toEqual({
        'uid-1': {
          sampleCount: 1,
          totalMs: 5,
          maxMs: 5,
          lastMs: 5
        }
      });

      resetRendererTracking();

      expect(getRendererTypes()).toEqual({});
      expect(getRendererFallbackReasonCounts()).toEqual({});
      expect(getRendererWebGLContextCounts()).toEqual({
        current: 0,
        peak: 0
      });
      expect(getRendererRuntimeMetricsByUid()).toEqual({});
      expect(getInputSendToWriteLatencyByUid()).toEqual({});
      expect(getAggregatedRendererRuntimeMetrics()).toEqual({
        inputKeydownToSend: {sampleCount: 0, totalMs: 0, maxMs: 0, lastMs: 0},
        frameTiming: {
          sampleCount: 0,
          totalMs: 0,
          maxMs: 0,
          lastMs: 0,
          longFrameCount: 0,
          longFrameThresholdMs: 16
        },
        reportIntervalMs: 0,
        updatedAtMs: 0
      });
      expect(getAggregatedInputSendToWriteLatencyMetrics()).toEqual({
        sampleCount: 0,
        totalMs: 0,
        maxMs: 0,
        lastMs: 0
      });
    });

    test('is idempotent when called repeatedly', () => {
      resetRendererTracking();
      expect(() => resetRendererTracking()).not.toThrow();

      expect(getRendererTypes()).toEqual({});
      expect(getRendererFallbackReasonCounts()).toEqual({});
      expect(getRendererWebGLContextCounts()).toEqual({
        current: 0,
        peak: 0
      });
    });
  });

  test('tracks renderer type by uid and records WebGL current/peak context counts', () => {
    setRendererType(asRendererUid('uid-1'), 'WebGL');
    setRendererType(asRendererUid('uid-2'), 'Canvas');
    setRendererType(asRendererUid('uid-3'), 'WebGL');
    setRendererType(asRendererUid('uid-1'), 'Canvas');
    unsetRendererType(asRendererUid('uid-3'));

    expect(getRendererTypes()).toEqual({
      'uid-1': 'Canvas',
      'uid-2': 'Canvas'
    });
    expect(getRendererWebGLContextCounts()).toEqual({
      current: 0,
      peak: 2
    });
    expect(getRendererFallbackReasonCounts()).toEqual({});
  });

  test('counts fallback reasons whenever a reason is provided', () => {
    setRendererType(asRendererUid('uid-1'), 'Canvas', 'context-loss');
    setRendererType(asRendererUid('uid-1'), 'Canvas', 'context-loss');
    setRendererType(asRendererUid('uid-2'), 'Canvas', 'pool-evicted');

    expect(getRendererFallbackReasonCounts()).toEqual({
      'context-loss': 2,
      'pool-evicted': 1
    });
  });

  const setupUnsetRendererTypeScenario = () => {
    const removedUid = asRendererUid('uid-1');
    const survivingUid = asRendererUid('uid-2');

    setRendererType(removedUid, 'Canvas', 'webgl-init-failed');
    setRendererType(survivingUid, 'Canvas');
    setRendererRuntimeMetrics(
      removedUid,
      createRuntimeMetrics({
        inputSampleCount: 3,
        inputTotalMs: 18,
        inputMaxMs: 10,
        inputLastMs: 0,
        frameSampleCount: 3,
        frameTotalMs: 45,
        frameMaxMs: 20,
        frameLastMs: 0,
        longFrameCount: 1,
        reportIntervalMs: 1000,
        updatedAtMs: 40
      })
    );
    setRendererRuntimeMetrics(
      survivingUid,
      createRuntimeMetrics({
        inputSampleCount: 1,
        inputTotalMs: 4,
        inputMaxMs: 4,
        inputLastMs: 4,
        frameSampleCount: 2,
        frameTotalMs: 28,
        frameMaxMs: 16,
        frameLastMs: 14,
        longFrameCount: 0,
        reportIntervalMs: 500,
        updatedAtMs: 50
      })
    );
    recordInputSendToWriteLatency(removedUid, 9);
    recordInputSendToWriteLatency(survivingUid, 7);

    return {removedUid, survivingUid};
  };

  const verifyFallbackCountersPreservedAfterUnset = (survivingUid: ReturnType<typeof asRendererUid>) => {
    expect(getRendererTypes()).toEqual({[survivingUid]: 'Canvas'});
    expect(getRendererFallbackReasonCounts()).toEqual({
      'webgl-init-failed': 1
    });
  };

  const verifyRuntimeMetricsCleanedUpAfterUnset = (survivingUid: ReturnType<typeof asRendererUid>) => {
    expect(getRendererRuntimeMetricsByUid()).toEqual({
      [survivingUid]: createRuntimeMetrics({
        inputSampleCount: 1,
        inputTotalMs: 4,
        inputMaxMs: 4,
        inputLastMs: 4,
        frameSampleCount: 2,
        frameTotalMs: 28,
        frameMaxMs: 16,
        frameLastMs: 14,
        longFrameCount: 0,
        reportIntervalMs: 500,
        updatedAtMs: 50
      })
    });
  };

  const verifyInputLatencyCleanedUpAfterUnset = (survivingUid: ReturnType<typeof asRendererUid>) => {
    expect(getInputSendToWriteLatencyByUid()).toEqual({
      [survivingUid]: {
        sampleCount: 1,
        totalMs: 7,
        maxMs: 7,
        lastMs: 7
      }
    });
  };

  const verifyAggregatedMetricsReflectOnlySurvivingRenderer = (survivingUid: ReturnType<typeof asRendererUid>) => {
    void survivingUid;

    expect(getAggregatedRendererRuntimeMetrics()).toEqual({
      inputKeydownToSend: {sampleCount: 1, totalMs: 4, maxMs: 4, lastMs: 4},
      frameTiming: {
        sampleCount: 2,
        totalMs: 28,
        maxMs: 16,
        lastMs: 14,
        longFrameCount: 0,
        longFrameThresholdMs: 16
      },
      reportIntervalMs: 500,
      updatedAtMs: 50
    });
    expect(getAggregatedInputSendToWriteLatencyMetrics()).toEqual({
      sampleCount: 1,
      totalMs: 7,
      maxMs: 7,
      lastMs: 7
    });
  };

  test('does not decrement fallback counters when sessions are unset', () => {
    const {removedUid, survivingUid} = setupUnsetRendererTypeScenario();

    unsetRendererType(removedUid);

    verifyFallbackCountersPreservedAfterUnset(survivingUid);
    verifyRuntimeMetricsCleanedUpAfterUnset(survivingUid);
    verifyInputLatencyCleanedUpAfterUnset(survivingUid);
    verifyAggregatedMetricsReflectOnlySurvivingRenderer(survivingUid);
  });

  test('only updates WebGL counts when WebGL classification changes', () => {
    setRendererType(asRendererUid('uid-1'), 'WebGL');
    setRendererType(asRendererUid('uid-1'), 'WebGL');
    setRendererType(asRendererUid('uid-1'), 'Canvas');
    setRendererType(asRendererUid('uid-1'), 'Canvas');

    expect(getRendererWebGLContextCounts()).toEqual({
      current: 0,
      peak: 1
    });
  });

  test('returns WebGL context counts as an immutable snapshot', () => {
    resetRendererTracking();
    setRendererType(asRendererUid('uid-1'), 'WebGL');
    setRendererType(asRendererUid('uid-2'), 'WebGL');

    const snapshot = getRendererWebGLContextCounts();
    snapshot.current = 0;
    snapshot.peak = 0;

    expect(getRendererWebGLContextCounts()).toEqual({
      current: 2,
      peak: 2
    });
  });

  describe('renderer runtime metrics aggregation', () => {
    test('aggregates runtime metrics across multiple UIDs and preserves valid zero lastMs values', () => {
      const uid1 = asRendererUid('uid-1');
      const uid2 = asRendererUid('uid-2');

      setRendererRuntimeMetrics(
        uid1,
        createRuntimeMetrics({
          inputSampleCount: 2,
          inputTotalMs: 20,
          inputMaxMs: 15,
          inputLastMs: 12,
          frameSampleCount: 2,
          frameTotalMs: 35,
          frameMaxMs: 20,
          frameLastMs: 18,
          longFrameCount: 1,
          longFrameThresholdMs: 16,
          reportIntervalMs: 1000,
          updatedAtMs: 10
        })
      );
      setRendererRuntimeMetrics(
        uid2,
        createRuntimeMetrics({
          inputSampleCount: 3,
          inputTotalMs: 30,
          inputMaxMs: 11,
          inputLastMs: 0,
          frameSampleCount: 4,
          frameTotalMs: 62,
          frameMaxMs: 19,
          frameLastMs: 0,
          longFrameCount: 2,
          longFrameThresholdMs: 17,
          reportIntervalMs: 1200,
          updatedAtMs: 25
        })
      );

      expect(getAggregatedRendererRuntimeMetrics()).toEqual({
        inputKeydownToSend: {
          sampleCount: 5,
          totalMs: 50,
          maxMs: 15,
          lastMs: 0
        },
        frameTiming: {
          sampleCount: 6,
          totalMs: 97,
          maxMs: 20,
          lastMs: 0,
          longFrameCount: 3,
          longFrameThresholdMs: 17
        },
        reportIntervalMs: 1200,
        updatedAtMs: 25
      });
    });

    test('returns zeroed runtime metrics when no runtime samples exist', () => {
      expect(getAggregatedRendererRuntimeMetrics()).toEqual({
        inputKeydownToSend: {sampleCount: 0, totalMs: 0, maxMs: 0, lastMs: 0},
        frameTiming: {
          sampleCount: 0,
          totalMs: 0,
          maxMs: 0,
          lastMs: 0,
          longFrameCount: 0,
          longFrameThresholdMs: 16
        },
        reportIntervalMs: 0,
        updatedAtMs: 0
      });
    });
  });

  describe('input send-to-write latency aggregation', () => {
    test('aggregates latency samples across multiple UIDs', () => {
      const uid1 = asRendererUid('uid-1');
      const uid2 = asRendererUid('uid-2');

      recordInputSendToWriteLatency(uid1, 5);
      recordInputSendToWriteLatency(uid1, 15);
      recordInputSendToWriteLatency(uid2, 10);

      expect(getAggregatedInputSendToWriteLatencyMetrics()).toEqual({
        sampleCount: 3,
        totalMs: 30,
        maxMs: 15,
        lastMs: 10
      });
    });

    test('returns zeroed latency metrics when no samples are recorded', () => {
      expect(getAggregatedInputSendToWriteLatencyMetrics()).toEqual({
        sampleCount: 0,
        totalMs: 0,
        maxMs: 0,
        lastMs: 0
      });
    });

    test('ignores non-finite latency samples', () => {
      const uid = asRendererUid('uid-1');

      recordInputSendToWriteLatency(uid, 10);
      const before = getAggregatedInputSendToWriteLatencyMetrics();

      recordInputSendToWriteLatency(uid, Number.NaN);
      recordInputSendToWriteLatency(uid, Number.POSITIVE_INFINITY);
      recordInputSendToWriteLatency(uid, Number.NEGATIVE_INFINITY);

      expect(getAggregatedInputSendToWriteLatencyMetrics()).toEqual(before);
    });
  });

  describe('PTY batching threshold metrics', () => {
    test('reflects runtime PTY batching constants and reports parity for matching values', () => {
      const metrics = getPtyBatchingThresholdMetrics();

      expect(metrics.durationMs).toBe(PTY_BATCH_DURATION_MS);
      expect(metrics.maxBytes).toBe(PTY_BATCH_MAX_BYTES);
      expect(metrics.maxKilobytes).toBe(200);
      expect(metrics.parity).toBe(true);
    });

    test('reports parity false for mismatched runtime threshold inputs', () => {
      const metrics = getPtyBatchingThresholdMetrics({
        durationMs: PTY_BATCH_DURATION_MS + 1,
        maxBytes: PTY_BATCH_MAX_BYTES
      });

      expect(metrics.durationMs).toBe(PTY_BATCH_DURATION_MS + 1);
      expect(metrics.maxBytes).toBe(PTY_BATCH_MAX_BYTES);
      expect(metrics.parity).toBe(false);
    });
  });
});
