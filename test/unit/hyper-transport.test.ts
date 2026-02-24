/** @file Verifies Hyper subscribes and unsubscribes via transport lifecycle. */
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';

import {afterAll, beforeAll, beforeEach, describe, expect, mock, test} from 'bun:test';

import {setupHappyDom} from '../testUtils/happy-dom';
import {createTransportMock} from '../testUtils/transport-mock';
import {waitFor} from '../testUtils/waitFor';

const {transportMock, resetTransportMock} = createTransportMock();

const createPluginExports = () => ({
  connect: () => (Component: React.ComponentType<unknown>) => Component,
  decorate: (Component: React.ComponentType<unknown>) => Component,
  getTabProps: (_tab: unknown, _parentProps: unknown, props: unknown) => props,
  subscribeTabDecorationUpdates: () => () => {}
});

const pluginModuleFactory = () => {
  const pluginExports = createPluginExports();
  return {...pluginExports, default: pluginExports};
};

const registerHyperModuleMocks = () => {
  // Re-register before importing Hyper to keep this suite stable if another
  // file calls mock.restore() earlier in the same Bun process.
  mock.module('../../lib/transport/electron-ipc-transport', () => ({transport: transportMock}));
  mock.module('../../lib/actions/ui', () => ({
    execCommand: () => ({type: 'exec'}),
    setFontSmoothing: () => ({type: 'UI_SET_FONT_SMOOTHING'})
  }));
  mock.module('../../lib/utils/plugins', pluginModuleFactory);
  mock.module('../../lib/utils/plugins.ts', pluginModuleFactory);
  mock.module('../../lib/containers/header', () => ({HeaderContainer: () => null}));
  mock.module('../../lib/containers/notifications', () => ({default: () => null}));
  mock.module('../../lib/containers/terms', () => ({
    default: (props: {ref_: (terms: unknown) => void}) => {
      props.ref_({
        getTermByUid: () => null,
        getActiveTerm: () => null
      });
      return null;
    }
  }));
  mock.module('mousetrap', () => ({
    default: class {
      stopCallback = () => false;
      bind() {}
      reset() {}
    }
  }));
  mock.module('../../lib/command-registry', () => ({
    getRegisteredKeys: async () => ({}),
    getCommandHandler: () => undefined,
    shouldPreventDefault: () => false
  }));
};

registerHyperModuleMocks();

type HyperProps = {
  activeSession: string | null;
  backgroundColor: string;
  borderColor: string;
  customCSS: string;
  execCommand: (...args: unknown[]) => void;
  fullScreen: boolean;
  isMac: boolean;
  lastConfigUpdate: number;
  maximized: boolean;
  uiFontFamily: string;
};
type HyperComponent = React.ComponentType<HyperProps>;

let Hyper: HyperComponent;
let cleanupHappyDom: (() => void) | null = null;

beforeAll(async () => {
  registerHyperModuleMocks();
  cleanupHappyDom = await setupHappyDom();
  // Provide window.rpc stub for any residual plugin-API references.
  (window as unknown as {rpc: Record<string, () => void>}).rpc = {
    on: () => {},
    off: () => {},
    removeListener: () => {}
  };
  ({default: Hyper} = await import('../../lib/containers/hyper'));
});

afterAll(() => {
  cleanupHappyDom?.();
  cleanupHappyDom = null;
});

beforeEach(() => {
  resetTransportMock();
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
  execCommand: () => {},
  ...overrides
});

const setupHyperContainer = () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return createRoot(container);
};

const mountHyper = async (root: ReturnType<typeof createRoot>, overrides: Partial<HyperProps> = {}) => {
  await act(async () => {
    root.render(React.createElement(Hyper, buildHyperProps(overrides)));
    await waitFor(0);
  });
};

const unmountHyper = async (root: ReturnType<typeof createRoot>) => {
  await act(async () => {
    root.unmount();
    await waitFor(0);
  });
};

describe('Hyper transport subscription lifecycle', () => {
  test.serial('subscribes to term selectAll on mount via transport', async () => {
    const root = setupHyperContainer();
    await mountHyper(root);

    const onCall = transportMock.on.mock.calls.find((call) => call[0] === 'term selectAll');

    expect(onCall).toBeDefined();
    expect(typeof onCall?.[1]).toBe('function');

    await unmountHyper(root);
  });

  test.serial('unsubscribes from term selectAll on unmount via transport', async () => {
    const root = setupHyperContainer();
    await mountHyper(root);
    await unmountHyper(root);

    const offCall = transportMock.off.mock.calls.find((call) => call[0] === 'term selectAll');

    expect(offCall).toBeDefined();
    expect(typeof offCall?.[1]).toBe('function');
  });

  test.serial('uses the same listener reference for on and off', async () => {
    const root = setupHyperContainer();
    await mountHyper(root);

    const onCall = transportMock.on.mock.calls.find((call) => call[0] === 'term selectAll');
    const onListener = onCall?.[1];

    await unmountHyper(root);

    const offCall = transportMock.off.mock.calls.find((call) => call[0] === 'term selectAll');
    const offListener = offCall?.[1];

    expect(onListener).toBe(offListener);
  });
});
