/** @file Verifies Hyper side effects for key bindings and focus. */
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';

import {beforeAll, beforeEach, expect, mock, test} from 'bun:test';

import {setupHappyDom} from '../testUtils/happy-dom';

const waitFor = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Terms ref used by Hyper to resolve focus and selection targets.
 */
type TermsRef = {
  getTermByUid: (uid: string) => {focus: () => void} | null;
  getActiveTerm: () => {focus: () => void; selectAll?: () => void} | null;
};
type KeyHandler = (event: {preventDefault: () => void; catched?: boolean}) => void;
type RpcWindow = Window & {
  rpc: {
    on: (event: string, callback: () => void) => void;
    off: (event: string, callback: () => void) => void;
    removeListener: (..._args: unknown[]) => void;
  };
  focusActiveTerm?: (uid?: string) => void;
};

/**
 * Hyper component type derived from the container export.
 */
type HyperComponent = typeof import('../../lib/containers/hyper').default;
type HyperProps = React.ComponentProps<HyperComponent>;

let Hyper: HyperComponent;
let registerCalls = 0;
let bindCalls = 0;
let resetCalls = 0;
let registeredKeys: Record<string, string> = {};
let commandHandlers: Record<string, ((event: unknown, dispatch: unknown) => void) | undefined> = {};
let shouldPreventDefaultResult = false;
let boundKeyHandlers: KeyHandler[] = [];
let termsRef: TermsRef = {
  getTermByUid: () => null,
  getActiveTerm: () => null
};

/**
 * Mousetrap test double that captures bind and reset activity.
 */
class MousetrapMock {
  bind(_keys: string, handler: KeyHandler) {
    bindCalls += 1;
    boundKeyHandlers.push(handler);
  }

  reset() {
    resetCalls += 1;
  }
}

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
  execCommand: () => {},
  ...overrides
});

const renderHyper = (root: ReturnType<typeof createRoot>, overrides: Partial<HyperProps> = {}) => {
  root.render(React.createElement(Hyper, buildHyperProps(overrides)));
};

/** Transport mock that captures on/off calls for select-all wiring. */
const transportListeners: Record<string, () => void> = {};
const transportRemovedListeners: string[] = [];
const transportMock = {
  invoke: mock(async () => ({})),
  emit: mock(() => true),
  on: mock((event: string, listener: () => void) => {
    transportListeners[event] = listener;
    return transportMock;
  }),
  once: mock((_event: string, _listener: () => void) => transportMock),
  off: mock((event: string, _listener: () => void) => {
    transportRemovedListeners.push(event);
    return transportMock;
  }),
  removeAllListeners: mock((_event?: string) => transportMock),
  destroy: mock(() => {})
};

mock.module('../../lib/transport/electron-ipc-transport', () => ({transport: transportMock}));

const buildRpcWindowStub = () => {
  const rpcWindow = window as RpcWindow;
  rpcWindow.rpc = {
    on: () => {},
    off: () => {},
    removeListener: () => {}
  };
  return {rpcWindow};
};

mock.module('../../lib/actions/ui', () => ({
  execCommand: () => ({type: 'exec'}),
  setFontSmoothing: () => ({type: 'UI_SET_FONT_SMOOTHING'})
}));

mock.module('../../lib/utils/plugins', () => ({
  connect: () => (Component: React.ComponentType<unknown>) => Component,
  decorate: (Component: React.ComponentType<unknown>) => Component
}));

mock.module('../../lib/containers/header', () => ({HeaderContainer: () => null}));
mock.module('../../lib/containers/notifications', () => ({default: () => null}));
mock.module('../../lib/containers/terms', () => ({
  default: (props: {ref_: (terms: TermsRef) => void}) => {
    props.ref_(termsRef);
    return null;
  }
}));

mock.module('mousetrap', () => ({default: MousetrapMock}));

mock.module('../../lib/command-registry', () => ({
  getRegisteredKeys: async () => {
    registerCalls += 1;
    return registeredKeys;
  },
  getCommandHandler: (command: string) => commandHandlers[command],
  shouldPreventDefault: () => shouldPreventDefaultResult
}));

beforeAll(async () => {
  ({default: Hyper} = await import('../../lib/containers/hyper'));
});

beforeEach(() => {
  registerCalls = 0;
  bindCalls = 0;
  resetCalls = 0;
  registeredKeys = {};
  commandHandlers = {};
  shouldPreventDefaultResult = false;
  boundKeyHandlers = [];
  termsRef = {
    getTermByUid: () => null,
    getActiveTerm: () => null
  };
  // Reset transport mock state
  for (const key of Object.keys(transportListeners)) {
    delete transportListeners[key];
  }
  transportRemovedListeners.length = 0;
  transportMock.on.mockClear();
  transportMock.off.mockClear();
});

test.serial('Hyper attaches key listeners on mount and config updates', async () => {
  const cleanup = await setupHappyDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  registeredKeys = {demo: 'demo:command'};

  const execCommand = () => {};

  await act(async () => {
    renderHyper(root, {execCommand});
    await waitFor(0);
  });

  expect(registerCalls).toBe(1);
  expect(bindCalls).toBeGreaterThan(0);
  expect(resetCalls).toBe(0);

  await act(async () => {
    renderHyper(root, {backgroundColor: '#111', execCommand});
    await waitFor(0);
  });

  expect(registerCalls).toBe(1);

  await act(async () => {
    renderHyper(root, {backgroundColor: '#111', lastConfigUpdate: 2, execCommand});
    await waitFor(0);
  });

  expect(registerCalls).toBe(2);

  await act(async () => {
    root.unmount();
  });
  cleanup();
});

test.serial('Hyper focuses the active session when it changes', async () => {
  const cleanup = await setupHappyDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
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
  cleanup();
});

test.serial('Hyper routes key handlers and select-all callbacks through terms', async () => {
  const cleanup = await setupHappyDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  const {rpcWindow} = buildRpcWindowStub();

  let commandCalls = 0;
  let preventedDefaultCalls = 0;
  let selectAllCalls = 0;
  let activeFocusCalls = 0;
  registeredKeys = {demo: 'demo:command'};
  shouldPreventDefaultResult = true;
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
    renderHyper(root, {
      execCommand: () => {
        commandCalls += 1;
      }
    });
    await waitFor(0);
  });

  expect(boundKeyHandlers).toHaveLength(1);
  boundKeyHandlers[0]({
    preventDefault: () => {
      preventedDefaultCalls += 1;
    }
  });
  expect(commandCalls).toBe(1);
  expect(preventedDefaultCalls).toBe(1);

  // select-all now wired through transport, not window.rpc
  const onSelectAll = transportListeners['term selectAll'];
  expect(onSelectAll).toBeDefined();
  if (!onSelectAll) {
    throw new Error('Expected transport listener for term selectAll.');
  }
  onSelectAll();
  expect(selectAllCalls).toBe(1);

  rpcWindow.focusActiveTerm?.();
  expect(activeFocusCalls).toBe(1);

  await act(async () => {
    root.unmount();
    await waitFor(0);
  });
  expect(transportRemovedListeners).toContain('term selectAll');
  cleanup();
});

test.serial('Hyper does not call preventDefault when key handlers allow default behaviour', async () => {
  const cleanup = await setupHappyDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  buildRpcWindowStub();

  let commandCalls = 0;
  let preventedDefaultCalls = 0;
  shouldPreventDefaultResult = false;
  registeredKeys = {demo: 'demo:command'};

  await act(async () => {
    renderHyper(root, {
      execCommand: () => {
        commandCalls += 1;
      }
    });
    await waitFor(0);
  });

  expect(boundKeyHandlers).toHaveLength(1);
  boundKeyHandlers[0]({
    preventDefault: () => {
      preventedDefaultCalls += 1;
    }
  });

  expect(commandCalls).toBe(1);
  expect(preventedDefaultCalls).toBe(0);

  await act(async () => {
    root.unmount();
  });
  cleanup();
});

test.serial('Hyper forwards local handlers and fallback commands to execCommand', async () => {
  const cleanup = await setupHappyDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  buildRpcWindowStub();

  const localHandler = mock((_event: unknown, _dispatch: unknown) => {});
  registeredKeys = {
    localShortcut: 'editor:search-close',
    remoteShortcut: 'tab:new'
  };
  commandHandlers = {
    'editor:search-close': localHandler
  };

  const execCommandCalls: Array<{command: string; handler: unknown; event: unknown}> = [];

  await act(async () => {
    renderHyper(root, {
      execCommand: (command: string, handler: unknown, event: unknown) => {
        execCommandCalls.push({command, handler, event});
      }
    });
    await waitFor(0);
  });

  expect(boundKeyHandlers).toHaveLength(2);

  const firstEvent = {preventDefault: () => {}};
  const secondEvent = {preventDefault: () => {}};
  boundKeyHandlers[0](firstEvent);
  boundKeyHandlers[1](secondEvent);

  expect(execCommandCalls).toHaveLength(2);
  expect(execCommandCalls[0]).toMatchObject({
    command: 'editor:search-close',
    handler: localHandler
  });
  expect(execCommandCalls[1]).toMatchObject({
    command: 'tab:new',
    handler: undefined
  });
  expect(execCommandCalls[0].event).toBe(firstEvent);
  expect(execCommandCalls[1].event).toBe(secondEvent);

  await act(async () => {
    root.unmount();
  });
  cleanup();
});
