/** @file Verifies Term.reportRenderer emits via transport with deduplication. */
import {describe, expect, mock, spyOn, test} from 'bun:test';
import {LONG_FRAME_THRESHOLD_MS, RUNTIME_METRICS_REPORT_INTERVAL_MS} from '@shared/constants/runtime-telemetry';
import {asRendererUid} from '@shared/types/common';

import {withTermTestHarness} from '../testUtils/term-harness';
import {clock} from '../../lib/utils/clock';

/** Type guard to identify WebGL addons by their onContextLoss method. */
function isWebGLAddon(addon: unknown): addon is {onContextLoss: () => void} {
  return (
    addon !== null && typeof addon === 'object' && 'onContextLoss' in addon && typeof addon.onContextLoss === 'function'
  );
}

describe('Term.reportRenderer transport emit', () => {
  test('emits info renderer via transport on first call', () =>
    withTermTestHarness(({Term, transportMock}) => {
      Term.reportRenderer({uid: asRendererUid('uid-1'), type: 'WebGL'});

      expect(transportMock.emit).toHaveBeenCalledTimes(1);
      expect(transportMock.emit).toHaveBeenCalledWith('info renderer', {uid: 'uid-1', type: 'WebGL'});
    }));

  test('does not emit when renderer type is unchanged and no reason or runtimeMetrics are provided', () =>
    withTermTestHarness(({Term, transportMock}) => {
      Term.reportRenderer({uid: asRendererUid('uid-2'), type: 'WebGL'});
      Term.reportRenderer({uid: asRendererUid('uid-2'), type: 'WebGL'});

      // The first report establishes the renderer type; the second is
      // suppressed because nothing changed, so exactly one emission survives
      // and it carries the first report's payload.
      expect(transportMock.emit).toHaveBeenCalledTimes(1);
      expect(transportMock.emit).toHaveBeenCalledWith('info renderer', {uid: 'uid-2', type: 'WebGL'});
    }));

  test('emits again when the renderer type changes for the same uid', () =>
    withTermTestHarness(({Term, transportMock}) => {
      Term.reportRenderer({uid: asRendererUid('uid-3'), type: 'WebGL'});
      Term.reportRenderer({uid: asRendererUid('uid-3'), type: 'Canvas'});

      expect(transportMock.emit).toHaveBeenCalledTimes(2);
      expect(transportMock.emit).toHaveBeenLastCalledWith('info renderer', {uid: 'uid-3', type: 'Canvas'});
    }));

  test('deduplication is per-uid, not global by type', () =>
    withTermTestHarness(({Term, transportMock}) => {
      Term.reportRenderer({uid: asRendererUid('uid-4'), type: 'WebGL'});
      Term.reportRenderer({uid: asRendererUid('uid-5'), type: 'WebGL'});

      expect(transportMock.emit).toHaveBeenCalledTimes(2);
      expect(transportMock.emit).toHaveBeenCalledWith('info renderer', {uid: 'uid-4', type: 'WebGL'});
      expect(transportMock.emit).toHaveBeenCalledWith('info renderer', {uid: 'uid-5', type: 'WebGL'});
    }));

  test('emits fallback reason even when renderer type is unchanged', () =>
    withTermTestHarness(({Term, transportMock}) => {
      Term.reportRenderer({uid: asRendererUid('uid-6'), type: 'Canvas'});
      Term.reportRenderer({uid: asRendererUid('uid-6'), type: 'Canvas', reason: 'context-loss'});

      expect(transportMock.emit).toHaveBeenCalledTimes(2);
      expect(transportMock.emit).toHaveBeenLastCalledWith('info renderer', {
        uid: 'uid-6',
        type: 'Canvas',
        reason: 'context-loss'
      });
    }));

  test('keeps plain renderer deduplication after a reasoned fallback event', () =>
    withTermTestHarness(({Term, transportMock}) => {
      Term.reportRenderer({uid: asRendererUid('uid-7'), type: 'Canvas', reason: 'pool-evicted'});
      Term.reportRenderer({uid: asRendererUid('uid-7'), type: 'Canvas'});

      expect(transportMock.emit).toHaveBeenCalledTimes(1);
      expect(transportMock.emit).toHaveBeenCalledWith('info renderer', {
        uid: 'uid-7',
        type: 'Canvas',
        reason: 'pool-evicted'
      });
    }));

  test('emits when only runtimeMetrics change for the same renderer type', () =>
    withTermTestHarness(({Term, transportMock}) => {
      const runtimeMetrics = {
        inputKeydownToSend: {
          sampleCount: 2,
          totalMs: 30,
          maxMs: 20,
          lastMs: 10
        },
        frameTiming: {
          sampleCount: 3,
          totalMs: 48,
          maxMs: 18,
          lastMs: 16,
          longFrameCount: 1,
          longFrameThresholdMs: LONG_FRAME_THRESHOLD_MS
        },
        reportIntervalMs: RUNTIME_METRICS_REPORT_INTERVAL_MS,
        updatedAtMs: clock.now()
      } as const;

      Term.reportRenderer({uid: asRendererUid('uid-8'), type: 'Canvas'});
      Term.reportRenderer({uid: asRendererUid('uid-8'), type: 'Canvas', runtimeMetrics});

      expect(transportMock.emit).toHaveBeenCalledTimes(2);
      expect(transportMock.emit).toHaveBeenLastCalledWith('info renderer', {
        uid: 'uid-8',
        type: 'Canvas',
        runtimeMetrics
      });
    }));
});

describe('Term.ensureWebGLRenderer fallback handling', () => {
  test('does not throw when WebGL addon attach fails', () =>
    withTermTestHarness(({createTermInstance, transportMock}) => {
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      const termInstance = createTermInstance('uid-webgl-failure');
      // @ts-expect-error Test double only needs loadAddon for this focused path.
      termInstance.term = {
        loadAddon: mock((addon: unknown) => {
          if (isWebGLAddon(addon)) {
            throw new Error('webgl attach failed');
          }
        })
      };

      const webGLContextPool = {acquire: mock(() => {})};

      // @ts-expect-error Pool double intentionally provides only the acquire hook.
      expect(() => termInstance.ensureWebGLRenderer(webGLContextPool)).not.toThrow();
      expect(transportMock.emit).toHaveBeenCalledWith('info renderer', {
        uid: 'uid-webgl-failure',
        type: 'Canvas',
        reason: 'webgl-init-failed'
      });
      expect(warnSpy).toHaveBeenCalledWith(
        'WebGL renderer initialization failed. Falling back to canvas-based rendering.',
        expect.any(Error)
      );
      warnSpy.mockRestore();
    }));
});

describe('Term WebGL context-loss and eviction handlers', () => {
  test('onWebGLContextLoss emits context-loss fallback and schedules retry', () =>
    withTermTestHarness(({createTermInstance}) => {
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      const termInstance = createTermInstance('uid-context-loss');
      termInstance.detachWebGLRenderer = mock(() => {});
      termInstance.ensureCanvasRenderer = mock(() => {});
      termInstance.scheduleRendererVisibilitySync = mock(() => {});
      termInstance.scheduleDeterministicRendererRetry = mock(() => {});
      termInstance.webglFailureCount = 0;

      termInstance.onWebGLContextLoss();

      expect(termInstance.webglFailureCount).toBe(1);
      expect(termInstance.ensureCanvasRenderer).toHaveBeenCalledWith('context-loss');
      expect(termInstance.scheduleRendererVisibilitySync).toHaveBeenCalledTimes(1);
      expect(termInstance.scheduleDeterministicRendererRetry).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith('WebGL context lost. Falling back to canvas-based rendering.');
      warnSpy.mockRestore();
    }));

  test('onWebGLEvicted emits pool-evicted fallback and uses delayed retry path only', () =>
    withTermTestHarness(({createTermInstance}) => {
      const termInstance = createTermInstance('uid-evicted');
      termInstance.detachWebGLRenderer = mock(() => {});
      termInstance.ensureCanvasRenderer = mock(() => {});
      termInstance.scheduleRendererVisibilitySync = mock(() => {});
      termInstance.scheduleDeterministicRendererRetry = mock(() => {});
      termInstance.webglFailureCount = 0;

      termInstance.onWebGLEvicted();

      expect(termInstance.webglFailureCount).toBe(1);
      expect(termInstance.ensureCanvasRenderer).toHaveBeenCalledWith('pool-evicted');
      expect(termInstance.scheduleRendererVisibilitySync).not.toHaveBeenCalled();
      expect(termInstance.scheduleDeterministicRendererRetry).toHaveBeenCalledTimes(1);
    }));
});

describe('Term runtime metrics flush behaviour', () => {
  test('forces runtimeMetrics emission during teardown so pending metrics are not lost', () =>
    withTermTestHarness(({createTermInstance, transportMock}) => {
      const uid = 'uid-force-flush';
      const termInstance = createTermInstance(uid);
      // @ts-expect-error The teardown path only checks for a truthy terminal reference.
      termInstance.term = {};
      termInstance.runtimeInputLatencyMetrics = {
        sampleCount: 3,
        totalMs: 45,
        maxMs: 20,
        lastMs: 15
      };
      termInstance.runtimeFrameTimingMetrics = {
        sampleCount: 3,
        totalMs: 52,
        maxMs: 21,
        lastMs: 17,
        longFrameCount: 1,
        longFrameThresholdMs: LONG_FRAME_THRESHOLD_MS
      };
      termInstance.hasUnreportedRuntimeMetrics = true;
      termInstance.componentWillUnmount();

      expect(transportMock.emit).toHaveBeenCalledTimes(1);
      expect(transportMock.emit).toHaveBeenCalledWith('info renderer', {
        uid,
        type: 'Canvas',
        runtimeMetrics: {
          inputKeydownToSend: {
            sampleCount: 3,
            totalMs: 45,
            maxMs: 20,
            lastMs: 15
          },
          frameTiming: {
            sampleCount: 3,
            totalMs: 52,
            maxMs: 21,
            lastMs: 17,
            longFrameCount: 1,
            longFrameThresholdMs: LONG_FRAME_THRESHOLD_MS
          },
          reportIntervalMs: RUNTIME_METRICS_REPORT_INTERVAL_MS,
          updatedAtMs: expect.any(Number)
        }
      });
    }));
});
