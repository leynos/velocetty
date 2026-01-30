/** @file Verifies Hyper side effects for key bindings and focus. */
import React from 'react';
import {createRoot} from 'react-dom/client';
// react-dom/test-utils is required until React 18.3+ exposes act from react.
import {act} from 'react-dom/test-utils';

import test from 'ava';

import {setupHappyDom} from '../testUtils/happy-dom';

const proxyquire = require('proxyquire').noCallThru();

const waitFor = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test.serial('Hyper attaches key listeners on mount and config updates', async (t) => {
  const cleanup = setupHappyDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  let registerCalls = 0;
  let bindCalls = 0;
  let resetCalls = 0;

  const Hyper = proxyquire('../../lib/containers/hyper', {
    '../actions/ui': {
      execCommand: () => ({type: 'exec'})
    },
    '../utils/plugins': {
      connect: () => (Component: React.ComponentType<unknown>) => Component
    },
    './header': {HeaderContainer: () => null},
    './notifications': () => null,
    './terms': (props: {ref_: (terms: unknown) => void}) => {
      props.ref_({
        getTermByUid: () => null,
        getActiveTerm: () => null
      });
      return null;
    },
    mousetrap: function MousetrapMock() {
      this.bind = () => {
        bindCalls += 1;
      };
      this.reset = () => {
        resetCalls += 1;
      };
      return this;
    },
    '../command-registry': {
      getRegisteredKeys: async () => {
        registerCalls += 1;
        return {demo: 'demo:command'};
      },
      getCommandHandler: () => () => {},
      shouldPreventDefault: () => false
    }
  }).default;

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

  t.is(registerCalls, 1);
  t.true(bindCalls > 0);
  t.is(resetCalls, 0);

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

  t.is(registerCalls, 1);

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

  t.is(registerCalls, 2);

  root.unmount();
  cleanup();
});

test.serial('Hyper focuses the active session when it changes', async (t) => {
  const cleanup = setupHappyDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  let focusCalls = 0;
  const termStub = {
    focus: () => {
      focusCalls += 1;
    }
  };

  const Hyper = proxyquire('../../lib/containers/hyper', {
    '../actions/ui': {
      execCommand: () => ({type: 'exec'})
    },
    '../utils/plugins': {
      connect: () => (Component: React.ComponentType<unknown>) => Component
    },
    './header': {HeaderContainer: () => null},
    './notifications': () => null,
    './terms': (props: {ref_: (terms: unknown) => void}) => {
      props.ref_({
        getTermByUid: (uid: string) => (uid === 'session-1' ? termStub : null),
        getActiveTerm: () => termStub
      });
      return null;
    },
    mousetrap: function MousetrapMock() {
      this.bind = () => {};
      this.reset = () => {};
      return this;
    },
    '../command-registry': {
      getRegisteredKeys: async () => ({}),
      getCommandHandler: () => () => {},
      shouldPreventDefault: () => false
    }
  }).default;

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

  t.is(focusCalls, 0);

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

  t.is(focusCalls, 1);

  root.unmount();
  cleanup();
});
