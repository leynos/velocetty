/**
 * @file Verifies Hyper side effects: focus, select-all wiring, and keybinding reloads.
 *
 * Key routing itself lives in `command-dispatch/keybinding.test.ts`. Hyper only
 * asks the bundle to reload the keymap, so this suite counts reloads and leaves
 * binding behaviour, refusal handling, and `preventDefault` to the binder's own
 * suite.
 *
 * Usage:
 * - `bun test --isolate test/unit/hyper-effects.test.ts`
 *
 * Related modules:
 * - `../../lib/containers/hyper.tsx`
 * - `../../lib/command-dispatch/inbound/command-dispatcher-provider.tsx`
 */
import React, {act} from 'react';
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';

import {afterEach, beforeEach, expect, mock, test} from 'bun:test';

import type {HyperProps} from '../../typings/hyper';
import type {RendererDispatcherBundle} from '../../lib/command-dispatch/compose';
import {CommandDispatcherProvider} from '../../lib/command-dispatch/inbound/command-dispatcher-provider';
import {setupHappyDom} from '../testUtils/happy-dom';
import {registerModuleMock} from '../testUtils/mock-module';
import {registerPluginsModuleMocks} from '../testUtils/plugins-mock';
import {createTransportMock} from '../testUtils/transport-mock';
import {waitFor} from '../testUtils/wait-for';

/** Terms ref used by Hyper to resolve focus and selection targets. */
type TermsRef = {
  getTermByUid: (uid: string) => {focus: () => void} | null;
  getActiveTerm: () => {focus: () => void; selectAll?: () => void} | null;
};

let reloadCalls = 0;
let resetCalls = 0;
let termsRef: TermsRef = {
  getTermByUid: () => null,
  getActiveTerm: () => null
};
let Hyper: React.ComponentType<HyperProps>;
let cleanupHappyDom: (() => void) | null = null;
let moduleInstanceCounter = 0;

/**
 * A bundle whose keybindings only record what Hyper asked of them.
 *
 * Only the contract Hyper actually uses is implemented; the dispatcher and the
 * plugin facade are never reached from this component.
 */
const createRecordingBundle = (): RendererDispatcherBundle => ({
  dispatcher: {
    check: () => ({admitted: true}),
    invoke: async () => ({status: 'ok'})
  },
  keybindings: {
    reload: async () => {
      reloadCalls += 1;
    },
    reset: () => {
      resetCalls += 1;
    }
  },
  invokeCommand: async () => ({status: 'ok'})
});

const buildHyperProps = (overrides: Partial<HyperProps> = {}): HyperProps => ({
  isMac: false,
  customCSS: '',
  uiFontFamily: 'sans-serif',
  borderColor: '#000',
  activeSession: null,
  backgroundColor: '#000',
  maximized: false,
  fullScreen: false,
  lastConfigUpdate: 1,
  ...overrides
});

/** One bundle per test, so the effect's dependency identity only changes when
 *  the config update counter does. */
let bundle: RendererDispatcherBundle = createRecordingBundle();

const renderHyper = (root: ReturnType<typeof createRoot>, overrides: Partial<HyperProps> = {}) => {
  const element = React.createElement(Hyper, buildHyperProps(overrides));
  const providerProps = {bundle};
  flushSync(() => {
    root.render(React.createElement(CommandDispatcherProvider, providerProps, element));
  });
};

/** Transport mock that captures on/off calls for select-all wiring. */
const {transportMock, state: transportMockState, resetTransportMock} = createTransportMock();
const transportRemovedListeners = transportMockState.removedEvents;

const registerHyperModuleMocks = () => {
  registerModuleMock('../../lib/transport/electron-ipc-transport', () => ({transport: transportMock}));
  registerPluginsModuleMocks({}, {defaultExportMode: 'self'});
  registerModuleMock('../../lib/containers/header', () => ({HeaderContainer: () => null}));
  registerModuleMock('../../lib/containers/notifications', () => ({default: () => null}));
  registerModuleMock('../../lib/containers/terms', () => ({
    default: (props: {ref_: (terms: TermsRef) => void}) => {
      props.ref_(termsRef);
      return null;
    }
  }));
};

const loadHyperComponent = async () => {
  registerHyperModuleMocks();
  moduleInstanceCounter += 1;
  ({default: Hyper} = await import(`../../lib/containers/hyper.tsx?hyper_effects=${moduleInstanceCounter}`));
};

beforeEach(async () => {
  bundle = createRecordingBundle();
  reloadCalls = 0;
  resetCalls = 0;
  termsRef = {
    getTermByUid: () => null,
    getActiveTerm: () => null
  };
  resetTransportMock();
  cleanupHappyDom = await setupHappyDom();
  await loadHyperComponent();
});

afterEach(() => {
  cleanupHappyDom?.();
  cleanupHappyDom = null;
  mock.restore();
});

test.serial('Hyper reloads keybindings on mount and when the config changes', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    renderHyper(root);
    await waitFor(0);
  });

  expect(reloadCalls).toBe(1);

  await act(async () => {
    renderHyper(root, {backgroundColor: '#111'});
    await waitFor(0);
  });

  // An unrelated prop change must not re-fetch the keymap.
  expect(reloadCalls).toBe(1);

  await act(async () => {
    renderHyper(root, {backgroundColor: '#111', lastConfigUpdate: 2});
    await waitFor(0);
  });

  expect(reloadCalls).toBe(2);

  await act(async () => {
    root.unmount();
  });
});

test.serial('Hyper resets keybindings on unmount', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    renderHyper(root);
    await waitFor(0);
  });

  await act(async () => {
    root.unmount();
    await waitFor(0);
  });

  expect(resetCalls).toBe(1);
});

test.serial('Hyper focuses the active session when it changes', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  let focusCalls = 0;
  const termStub = {
    focus: () => {
      focusCalls += 1;
    }
  };

  termsRef = {
    getTermByUid: (uid: string) => (uid === 'session-1' ? termStub : null),
    getActiveTerm: () => termStub
  };

  await act(async () => {
    renderHyper(root);
    await waitFor(0);
  });

  expect(focusCalls).toBe(0);

  await act(async () => {
    renderHyper(root, {activeSession: 'session-1'});
    await waitFor(0);
  });

  expect(focusCalls).toBe(1);

  await act(async () => {
    root.unmount();
  });
});

test.serial('Hyper routes select-all through transport and publishes the focus helper', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  let selectAllCalls = 0;
  let activeFocusCalls = 0;
  const activeTerm = {
    focus: () => {
      activeFocusCalls += 1;
    },
    selectAll: () => {
      selectAllCalls += 1;
    }
  };
  termsRef = {
    getTermByUid: () => null,
    getActiveTerm: () => activeTerm
  };

  await act(async () => {
    renderHyper(root);
    await waitFor(0);
  });

  const selectAllListeners = transportMockState.listenersByEvent['term selectAll'];
  expect(selectAllListeners).toBeDefined();
  if (!selectAllListeners) {
    throw new Error('Expected transport listener for term selectAll.');
  }
  for (const listener of selectAllListeners) {
    listener();
  }
  expect(selectAllCalls).toBe(1);

  // Hyper only publishes the helper once its terms ref runs; read it after
  // rendering and fail loudly if the wiring disappeared.
  // SAFETY: `Hyper` assigns this helper on `globalThis` from its terms ref; the
  // guarded read below is what proves it exists.
  const focusActiveTerm = (globalThis as {focusActiveTerm?: (uid?: string) => void}).focusActiveTerm;
  if (!focusActiveTerm) {
    throw new Error('Expected Hyper to publish focusActiveTerm.');
  }
  focusActiveTerm();
  expect(activeFocusCalls).toBe(1);

  await act(async () => {
    root.unmount();
    await waitFor(0);
  });
  expect(transportRemovedListeners).toContain('term selectAll');
});
