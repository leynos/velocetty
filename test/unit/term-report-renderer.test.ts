/** @file Verifies Term.reportRenderer emits via transport with deduplication. */
import {afterAll, beforeAll, beforeEach, describe, expect, mock, test} from 'bun:test';
import {LONG_FRAME_THRESHOLD_MS, RUNTIME_METRICS_REPORT_INTERVAL_MS} from '@shared/constants/runtime-telemetry';

import {setupHappyDom} from '../testUtils/happy-dom';
import {registerPluginsModuleMocks} from '../testUtils/plugins-mock';
import {createTransportMock} from '../testUtils/transport-mock';
import {clock} from '../../lib/utils/clock';

/** Type guard to identify WebGL addons by their onContextLoss method. */
function isWebGLAddon(addon: unknown): addon is {onContextLoss: () => void} {
  return (
    addon !== null && typeof addon === 'object' && 'onContextLoss' in addon && typeof addon.onContextLoss === 'function'
  );
}

const {transportMock, resetTransportMock} = createTransportMock();

mock.module('../../lib/transport/electron-ipc-transport', () => ({transport: transportMock}));

// Stub heavy renderer dependencies that Term pulls in transitively.
mock.module('electron', () => ({
  clipboard: {writeText: mock(() => {}), readText: mock(() => '')},
  shell: {openExternal: mock(async () => {})},
  ipcRenderer: {
    invoke: mock(async () => ({})),
    on: mock(() => {}),
    send: mock(() => {}),
    removeAllListeners: mock(() => {}),
    removeListener: mock(() => {})
  }
}));
mock.module('color', () => ({
  default: () => ({
    alpha() {
      return 1;
    },
    hex() {
      return '#000000';
    }
  })
}));
mock.module('xterm', () => ({Terminal: class {}}));
mock.module('xterm-addon-canvas', () => ({CanvasAddon: class {}}));
mock.module('xterm-addon-fit', () => ({FitAddon: class {}}));
mock.module('xterm-addon-image', () => ({ImageAddon: class {}}));
mock.module('xterm-addon-ligatures', () => ({LigaturesAddon: class {}}));
mock.module('xterm-addon-search', () => ({SearchAddon: class {}}));
mock.module('xterm-addon-unicode11', () => ({Unicode11Addon: class {}}));
mock.module('xterm-addon-web-links', () => ({WebLinksAddon: class {}}));
mock.module('xterm-addon-webgl', () => ({
  WebglAddon: class {
    onContextLoss() {}
    dispose() {}
  }
}));
mock.module('xterm/css/xterm.css', () => ({}));
mock.module('../../lib/terms', () => ({default: {}}));
mock.module('../../lib/utils/paste', () => ({default: () => null}));
registerPluginsModuleMocks();
mock.module('../../lib/components/searchBox', () => ({default: () => null}));

let Term: typeof import('../../lib/components/term').default;
let cleanupHappyDom: (() => void) | null = null;

const createTermInstanceForWebGLFallbackTest = (uid: string) => {
  // @ts-expect-error Test constructor setup intentionally uses a minimal prop subset.
  return new Term({
    uid,
    ref_: mock(() => {}),
    cursorColor: '#ffffff',
    borderColor: '#000000'
  });
};

beforeAll(async () => {
  cleanupHappyDom = await setupHappyDom();
  ({default: Term} = await import('../../lib/components/term'));
});

afterAll(() => {
  mock.restore();
  cleanupHappyDom?.();
  cleanupHappyDom = null;
});

beforeEach(() => {
  resetTransportMock();
  // Reset the static renderer type cache between tests.
  Term.rendererTypes = {};
});

describe('Term.reportRenderer transport emit', () => {
  test('emits info renderer via transport on first call', () => {
    Term.reportRenderer({uid: 'uid-1', type: 'WebGL'});

    expect(transportMock.emit).toHaveBeenCalledTimes(1);
    expect(transportMock.emit).toHaveBeenCalledWith('info renderer', {uid: 'uid-1', type: 'WebGL'});
  });

  test('does not emit when renderer type is unchanged and no reason or runtimeMetrics are provided', () => {
    Term.reportRenderer({uid: 'uid-2', type: 'WebGL'});
    Term.reportRenderer({uid: 'uid-2', type: 'WebGL'});

    expect(transportMock.emit).toHaveBeenCalledTimes(1);
  });

  test('emits again when the renderer type changes for the same uid', () => {
    Term.reportRenderer({uid: 'uid-3', type: 'WebGL'});
    Term.reportRenderer({uid: 'uid-3', type: 'Canvas'});

    expect(transportMock.emit).toHaveBeenCalledTimes(2);
    expect(transportMock.emit).toHaveBeenLastCalledWith('info renderer', {uid: 'uid-3', type: 'Canvas'});
  });

  test('deduplication is per-uid, not global by type', () => {
    Term.reportRenderer({uid: 'uid-4', type: 'WebGL'});
    Term.reportRenderer({uid: 'uid-5', type: 'WebGL'});

    expect(transportMock.emit).toHaveBeenCalledTimes(2);
    expect(transportMock.emit).toHaveBeenCalledWith('info renderer', {uid: 'uid-4', type: 'WebGL'});
    expect(transportMock.emit).toHaveBeenCalledWith('info renderer', {uid: 'uid-5', type: 'WebGL'});
  });

  test('emits fallback reason even when renderer type is unchanged', () => {
    Term.reportRenderer({uid: 'uid-6', type: 'Canvas'});
    Term.reportRenderer({uid: 'uid-6', type: 'Canvas', reason: 'context-loss'});

    expect(transportMock.emit).toHaveBeenCalledTimes(2);
    expect(transportMock.emit).toHaveBeenLastCalledWith('info renderer', {
      uid: 'uid-6',
      type: 'Canvas',
      reason: 'context-loss'
    });
  });

  test('keeps plain renderer deduplication after a reasoned fallback event', () => {
    Term.reportRenderer({uid: 'uid-7', type: 'Canvas', reason: 'pool-evicted'});
    Term.reportRenderer({uid: 'uid-7', type: 'Canvas'});

    expect(transportMock.emit).toHaveBeenCalledTimes(1);
    expect(transportMock.emit).toHaveBeenCalledWith('info renderer', {
      uid: 'uid-7',
      type: 'Canvas',
      reason: 'pool-evicted'
    });
  });

  test('emits when only runtimeMetrics change for the same renderer type', () => {
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

    Term.reportRenderer({uid: 'uid-8', type: 'Canvas'});
    Term.reportRenderer({uid: 'uid-8', type: 'Canvas', runtimeMetrics});

    expect(transportMock.emit).toHaveBeenCalledTimes(2);
    expect(transportMock.emit).toHaveBeenLastCalledWith('info renderer', {
      uid: 'uid-8',
      type: 'Canvas',
      runtimeMetrics
    });
  });
});

describe('Term.ensureWebGLRenderer fallback handling', () => {
  test('does not throw when WebGL addon attach fails', () => {
    const termInstance = createTermInstanceForWebGLFallbackTest('uid-webgl-failure');
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
  });
});

describe('Term WebGL context-loss and eviction handlers', () => {
  test('onWebGLContextLoss emits context-loss fallback and schedules retry', () => {
    const termInstance = createTermInstanceForWebGLFallbackTest('uid-context-loss');
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
  });

  test('onWebGLEvicted emits pool-evicted fallback and uses delayed retry path only', () => {
    const termInstance = createTermInstanceForWebGLFallbackTest('uid-evicted');
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
  });
});

describe('Term runtime metrics flush behaviour', () => {
  test('forces runtimeMetrics emission during teardown so pending metrics are not lost', () => {
    const uid = 'uid-force-flush';
    const termInstance = createTermInstanceForWebGLFallbackTest(uid);
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
  });
});
