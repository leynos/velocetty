/** @file Verifies Term.reportRenderer emits via transport with deduplication. */
import {randomUUID} from 'node:crypto';

import {describe, expect, mock, spyOn, test} from 'bun:test';
import {
  LONG_FRAME_THRESHOLD_MS,
  resetInputSendTimestamps,
  RUNTIME_METRICS_REPORT_INTERVAL_MS
} from '@shared/constants/runtime-telemetry';
import {asRendererUid} from '@shared/types/common';

import {setupHappyDom} from '../testUtils/happy-dom';
import {registerPluginsModuleMocks} from '../testUtils/plugins-mock';
import {createTransportMock} from '../testUtils/transport-mock';
import {clock} from '../../lib/utils/clock';
import * as realPaste from '../../lib/utils/paste';

/** Type guard to identify WebGL addons by their onContextLoss method. */
function isWebGLAddon(addon: unknown): addon is {onContextLoss: () => void} {
  return (
    addon !== null && typeof addon === 'object' && 'onContextLoss' in addon && typeof addon.onContextLoss === 'function'
  );
}

const registerTermModuleMocks = (transportMock: ReturnType<typeof createTransportMock>['transportMock']) => {
  mock.module('../../lib/transport/electron-ipc-transport', () => ({transport: transportMock}));

  // Stub heavy renderer dependencies that Term pulls in transitively.
  mock.module('electron', () => ({
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
  // Force the file-list interception path on every test platform; the real
  // formatting helpers still run so the assertions cover their output.
  mock.module('../../lib/utils/paste', () => ({...realPaste, shouldInterceptFilePaste: () => true}));
  registerPluginsModuleMocks();
  mock.module('../../lib/components/searchBox', () => ({default: () => null}));
};

type TermModule = typeof import('../../lib/components/term').default;

type TermTestHarness = {
  Term: TermModule;
  cleanup: () => void;
  createTermInstanceForWebGLFallbackTest: (uid: string) => InstanceType<TermModule>;
  transportMock: ReturnType<typeof createTransportMock>['transportMock'];
};

const createTermTestHarness = async (): Promise<TermTestHarness> => {
  const cleanupHappyDom = await setupHappyDom();
  const {transportMock} = createTransportMock();
  let cleanupCalled = false;

  const cleanup = () => {
    if (cleanupCalled) {
      return;
    }
    cleanupCalled = true;
    try {
      mock.restore();
      resetInputSendTimestamps();
    } finally {
      cleanupHappyDom();
    }
  };

  try {
    registerTermModuleMocks(transportMock);
    const {default: Term} = await import(`../../lib/components/term.tsx?term_report_renderer=${randomUUID()}`);
    Term.rendererTypes = {} as typeof Term.rendererTypes;
    resetInputSendTimestamps();

    const createTermInstanceForWebGLFallbackTest = (uid: string) => {
      // @ts-expect-error Test constructor setup intentionally uses a minimal prop subset.
      return new Term({
        uid,
        ref_: mock(() => {}),
        cursorColor: '#ffffff',
        borderColor: '#000000'
      });
    };

    return {Term, cleanup, createTermInstanceForWebGLFallbackTest, transportMock};
  } catch (error) {
    cleanup();
    throw error;
  }
};

const withTermTestHarness = async (run: (harness: TermTestHarness) => Promise<void> | void) => {
  const harness = await createTermTestHarness();
  try {
    await run(harness);
  } finally {
    harness.cleanup();
  }
};

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

      expect(transportMock.emit).toHaveBeenCalledTimes(1);
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
    withTermTestHarness(({createTermInstanceForWebGLFallbackTest, transportMock}) => {
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
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
      expect(warnSpy).toHaveBeenCalledWith(
        'WebGL renderer initialization failed. Falling back to canvas-based rendering.',
        expect.any(Error)
      );
      warnSpy.mockRestore();
    }));
});

describe('Term WebGL context-loss and eviction handlers', () => {
  test('onWebGLContextLoss emits context-loss fallback and schedules retry', () =>
    withTermTestHarness(({createTermInstanceForWebGLFallbackTest}) => {
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
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
      expect(warnSpy).toHaveBeenCalledWith('WebGL context lost. Falling back to canvas-based rendering.');
      warnSpy.mockRestore();
    }));

  test('onWebGLEvicted emits pool-evicted fallback and uses delayed retry path only', () =>
    withTermTestHarness(({createTermInstanceForWebGLFallbackTest}) => {
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
    }));
});

describe('Term runtime metrics flush behaviour', () => {
  test('forces runtimeMetrics emission during teardown so pending metrics are not lost', () =>
    withTermTestHarness(({createTermInstanceForWebGLFallbackTest, transportMock}) => {
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
    }));
});

describe('Term clipboard paste routing', () => {
  type PasteCapableTerm = {
    props: {isTermActive: boolean};
    term: {paste: (data: string) => void};
    termWrapperRef: HTMLElement | null;
    onWindowPaste: (e: Event) => void;
  };

  const createPasteEvent = (target: EventTarget) => {
    const event = new window.Event('paste', {bubbles: true, cancelable: true});
    Object.defineProperty(event, 'target', {value: target});
    return event;
  };

  const createPasteHarness = (createTermInstance: (uid: string) => PasteCapableTerm, isTermActive: boolean) => {
    const termWrapperRef = document.createElement('div');
    const terminal = document.createElement('span');
    termWrapperRef.appendChild(terminal);
    document.body.appendChild(termWrapperRef);

    const termInstance = createTermInstance('uid-paste');
    termInstance.props = {isTermActive};
    termInstance.termWrapperRef = termWrapperRef;
    const term = {paste: mock(() => {})};
    termInstance.term = term;
    return {term, termInstance, terminal, termWrapperRef};
  };

  /** Lets the awaited clipboard reads settle before assertions run. */
  const flushClipboardReads = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  test('leaves paste untouched when the term is inactive', () =>
    withTermTestHarness(async ({createTermInstanceForWebGLFallbackTest, transportMock}) => {
      const {termInstance, terminal} = createPasteHarness(
        createTermInstanceForWebGLFallbackTest as unknown as (uid: string) => PasteCapableTerm,
        false
      );
      const event = createPasteEvent(terminal);

      termInstance.onWindowPaste(event);
      await flushClipboardReads();

      expect(event.defaultPrevented).toBe(false);
      expect(transportMock.invoke).not.toHaveBeenCalled();
    }));

  test('leaves paste untouched for events outside the terminal wrapper', () =>
    withTermTestHarness(async ({createTermInstanceForWebGLFallbackTest, transportMock}) => {
      const {termInstance} = createPasteHarness(
        createTermInstanceForWebGLFallbackTest as unknown as (uid: string) => PasteCapableTerm,
        true
      );
      const event = createPasteEvent(document.createElement('div'));

      termInstance.onWindowPaste(event);
      await flushClipboardReads();

      expect(event.defaultPrevented).toBe(false);
      expect(transportMock.invoke).not.toHaveBeenCalled();
    }));

  test('prevents the native paste and writes clipboard text into the terminal', () =>
    withTermTestHarness(async ({createTermInstanceForWebGLFallbackTest, transportMock}) => {
      const {term, termInstance, terminal} = createPasteHarness(
        createTermInstanceForWebGLFallbackTest as unknown as (uid: string) => PasteCapableTerm,
        true
      );
      transportMock.invoke.mockImplementation(async (channel: string) =>
        channel === 'clipboard.readFilePaths' ? [] : 'plain text'
      );
      const event = createPasteEvent(terminal);

      termInstance.onWindowPaste(event);
      await flushClipboardReads();

      expect(event.defaultPrevented).toBe(true);
      expect(transportMock.invoke).toHaveBeenCalledWith('clipboard.readFilePaths');
      expect(transportMock.invoke).toHaveBeenCalledWith('clipboard.readText');
      expect(term.paste).toHaveBeenCalledWith('plain text');
    }));

  test('pastes copied file paths without asking for clipboard text', () =>
    withTermTestHarness(async ({createTermInstanceForWebGLFallbackTest, transportMock}) => {
      const {term, termInstance, terminal} = createPasteHarness(
        createTermInstanceForWebGLFallbackTest as unknown as (uid: string) => PasteCapableTerm,
        true
      );
      transportMock.invoke.mockImplementation(async (channel: string) =>
        channel === 'clipboard.readFilePaths' ? ['/tmp/a.txt'] : 'unused'
      );
      const event = createPasteEvent(terminal);

      termInstance.onWindowPaste(event);
      await flushClipboardReads();

      expect(event.defaultPrevented).toBe(true);
      expect(transportMock.invoke).not.toHaveBeenCalledWith('clipboard.readText');
      expect(term.paste).toHaveBeenCalledWith("'/tmp/a.txt'");
    }));
});

describe('Term quick-edit clipboard routing', () => {
  type QuickEditTerm = {
    props: {quickEdit: boolean; copyOnSelect: boolean};
    term: {hasSelection: () => boolean; getSelection: () => string; clearSelection: () => void};
    onMouseUp: (e: React.MouseEvent) => void;
  };

  const createQuickEditInstance = (createTermInstance: (uid: string) => unknown, hasSelection: boolean) => {
    const termInstance = createTermInstance('uid-quick-edit') as QuickEditTerm & {
      pasteClipboardText: () => Promise<void>;
    };
    termInstance.props = {quickEdit: true, copyOnSelect: false};
    termInstance.term = {
      hasSelection: () => hasSelection,
      getSelection: () => 'selected text',
      clearSelection: mock(() => {})
    };
    return termInstance;
  };

  const rightClick = () => ({button: 2}) as React.MouseEvent;

  test('copies the selection through the main process when one exists', () =>
    withTermTestHarness(({createTermInstanceForWebGLFallbackTest, transportMock}) => {
      const termInstance = createQuickEditInstance(createTermInstanceForWebGLFallbackTest, true);

      termInstance.onMouseUp(rightClick());

      expect(transportMock.invoke).toHaveBeenCalledWith('clipboard.writeText', 'selected text');
      expect(termInstance.term.clearSelection).toHaveBeenCalledTimes(1);
    }));

  test('pastes clipboard text when quick edit finds no selection', () =>
    withTermTestHarness(async ({createTermInstanceForWebGLFallbackTest, transportMock}) => {
      const termInstance = createQuickEditInstance(createTermInstanceForWebGLFallbackTest, false);
      transportMock.invoke.mockImplementation(async () => 'clipboard text');
      const pasteSpy = mock(() => {});
      (termInstance as unknown as {term: {paste: typeof pasteSpy}}).term.paste = pasteSpy;

      termInstance.onMouseUp(rightClick());
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(transportMock.invoke).toHaveBeenCalledWith('clipboard.readText');
      expect(pasteSpy).toHaveBeenCalledWith('clipboard text');
    }));
});
