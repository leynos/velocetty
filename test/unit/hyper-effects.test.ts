/** @file Verifies Hyper side effects for key bindings and focus. */
import React from 'react';
import {createRoot} from 'react-dom/client';
// react-dom/test-utils is required until React 18.3+ exposes act from react.
import {act} from 'react-dom/test-utils';

import {afterAll, beforeAll, beforeEach, expect, mock, test} from 'bun:test';

import {setupHappyDom} from '../testUtils/happy-dom';

const waitFor = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type TermsRef = {
  getTermByUid: (uid: string) => {focus: () => void} | null;
  getActiveTerm: () => {focus: () => void; selectAll?: () => void} | null;
};

let Hyper: React.ComponentType<any>;
let registerCalls = 0;
let bindCalls = 0;
let resetCalls = 0;
let registeredKeys: Record<string, string> = {};
let termsRef: TermsRef = {
  getTermByUid: () => null,
  getActiveTerm: () => null
};

class MousetrapMock {
  bind() {
    bindCalls += 1;
  }

  reset() {
    resetCalls += 1;
  }
}

mock.module('../../lib/actions/ui', () => ({
  execCommand: () => ({type: 'exec'})
}));

mock.module('../../lib/utils/plugins', () => ({
  connect: () => (Component: React.ComponentType<unknown>) => Component
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
  getCommandHandler: () => () => {},
  shouldPreventDefault: () => false
}));

beforeAll(async () => {
  ({default: Hyper} = await import('../../lib/containers/hyper'));
});

beforeEach(() => {
  registerCalls = 0;
  bindCalls = 0;
  resetCalls = 0;
  registeredKeys = {};
  termsRef = {
    getTermByUid: () => null,
    getActiveTerm: () => null
  };
});

afterAll(() => {
  mock.restore();
});

test.serial('Hyper attaches key listeners on mount and config updates', async () => {
  const cleanup = await setupHappyDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  registeredKeys = {demo: 'demo:command'};

  const execCommand = () => {};

  await act(async () => {
    root.render(
      React.createElement(Hyper, {
        isMac: false,
        customCSS: '',
        uiFontFamily: 'sans-serif',
        borderColor: '#000',
        activeSession: null,
        backgroundColor: '#000',
        maximized: false,
        fullScreen: false,
        lastConfigUpdate: 1,
        execCommand
      })
    );
    await waitFor(0);
  });

  expect(registerCalls).toBe(1);
  expect(bindCalls > 0).toBe(true);
  expect(resetCalls).toBe(0);

  await act(async () => {
    root.render(
      React.createElement(Hyper, {
        isMac: false,
        customCSS: '',
        uiFontFamily: 'sans-serif',
        borderColor: '#000',
        activeSession: null,
        backgroundColor: '#111',
        maximized: false,
        fullScreen: false,
        lastConfigUpdate: 1,
        execCommand
      })
    );
    await waitFor(0);
  });

  expect(registerCalls).toBe(1);

  await act(async () => {
    root.render(
      React.createElement(Hyper, {
        isMac: false,
        customCSS: '',
        uiFontFamily: 'sans-serif',
        borderColor: '#000',
        activeSession: null,
        backgroundColor: '#111',
        maximized: false,
        fullScreen: false,
        lastConfigUpdate: 2,
        execCommand
      })
    );
    await waitFor(0);
  });

  expect(registerCalls).toBe(2);

  root.unmount();
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
    root.render(
      React.createElement(Hyper, {
        isMac: false,
        customCSS: '',
        uiFontFamily: 'sans-serif',
        borderColor: '#000',
        activeSession: null,
        backgroundColor: '#000',
        maximized: false,
        fullScreen: false,
        lastConfigUpdate: 1,
        execCommand: () => {}
      })
    );
    await waitFor(0);
  });

  expect(focusCalls).toBe(0);

  await act(async () => {
    root.render(
      React.createElement(Hyper, {
        isMac: false,
        customCSS: '',
        uiFontFamily: 'sans-serif',
        borderColor: '#000',
        activeSession: 'session-1',
        backgroundColor: '#000',
        maximized: false,
        fullScreen: false,
        lastConfigUpdate: 1,
        execCommand: () => {}
      })
    );
    await waitFor(0);
  });

  expect(focusCalls).toBe(1);

  root.unmount();
  cleanup();
});
