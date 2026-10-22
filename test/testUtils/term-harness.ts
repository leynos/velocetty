/**
 * @file Builds an isolated Term component harness for unit tests.
 *
 * The harness stubs the heavy renderer dependencies that `Term` pulls in and
 * loads a cache-busted copy of the component, so each suite gets its own class
 * identity and module state.
 *
 * Invariants:
 * - Module mocks installed here must only cover dependencies that no other
 *   suite imports directly. Bun's `mock.module` registry is process-wide and
 *   suites run concurrently, so mocking an app module would leak into them.
 * - Every harness is paired with `cleanup`, which restores the global mocks and
 *   releases the Happy DOM lease.
 *
 * Cross-links:
 * - Component under test: `lib/components/term.tsx`
 * - Transport double: `test/testUtils/transport-mock.ts`
 */
import {randomUUID} from 'node:crypto';

import {mock} from 'bun:test';

import {resetInputSendTimestamps} from '@shared/constants/runtime-telemetry';

import {setupHappyDom} from './happy-dom';
import {registerPluginsModuleMocks} from './plugins-mock';
import {createTransportMock} from './transport-mock';

type TransportMock = ReturnType<typeof createTransportMock>['transportMock'];

const registerTermModuleMocks = (transportMock: TransportMock) => {
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
  registerPluginsModuleMocks();
  mock.module('../../lib/components/search-box', () => ({default: () => null}));
};

type TermModule = typeof import('../../lib/components/term').default;

export type TermTestHarness = {
  Term: TermModule;
  cleanup: () => void;
  /**
   * Builds a `Term` from the minimal prop subset the constructor needs.
   *
   * `T` defaults to the full class; suites that exercise a private or
   * partially arranged surface name the narrower shape they have set up.
   */
  createTermInstance: <T = InstanceType<TermModule>>(uid: string) => T;
  transportMock: TransportMock;
};

/**
 * Creates a Term class whose constructor accepts a minimal prop subset.
 *
 * Example:
 * - `const {Term} = await createTermTestHarness()` then
 *   `new Term({uid, ref_: mock(() => {})})`.
 */
export const createTermTestHarness = async (cacheKey = 'term_harness'): Promise<TermTestHarness> => {
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
    const {default: Term} = await import(`../../lib/components/term.tsx?${cacheKey}=${randomUUID()}`);
    // Each harness loads its own cache-busted module, so the shared renderer
    // registry must start empty or deduplication would leak across suites.
    Term.rendererTypes = {};
    resetInputSendTimestamps();

    const createTermInstance = <T = InstanceType<TermModule>>(uid: string): T => {
      // @ts-expect-error Test constructor setup intentionally uses a minimal prop subset.
      return new Term({
        uid,
        ref_: mock(() => {}),
        cursorColor: '#ffffff',
        borderColor: '#000000'
      });
    };

    return {Term, cleanup, createTermInstance, transportMock};
  } catch (error) {
    cleanup();
    throw error;
  }
};

/**
 * Runs `run` against a fresh harness and always tears the harness down.
 *
 * Example:
 * - `await withTermTestHarness(({Term, transportMock}) => { ... })`.
 */
export const withTermTestHarness = async (run: (harness: TermTestHarness) => Promise<void> | void) => {
  const harness = await createTermTestHarness();
  try {
    await run(harness);
  } finally {
    harness.cleanup();
  }
};
