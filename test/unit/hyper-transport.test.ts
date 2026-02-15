/** @file Verifies Hyper subscribes and unsubscribes via transport lifecycle. */
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';

import {afterAll, beforeAll, beforeEach, describe, expect, mock, test} from 'bun:test';

import {setupHappyDom} from '../testUtils/happy-dom';

const waitFor = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Listener = (...args: unknown[]) => void;

const transportMock = {
  invoke: mock(async () => ({})),
  emit: mock(() => true),
  on: mock((_event: string, _listener: Listener) => transportMock),
  once: mock((_event: string, _listener: Listener) => transportMock),
  off: mock((_event: string, _listener: Listener) => transportMock),
  removeAllListeners: mock((_event?: string) => transportMock),
  destroy: mock(() => {})
};

mock.module('../../lib/transport/electron-ipc-transport', () => ({transport: transportMock}));

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

type HyperComponent = typeof import('../../lib/containers/hyper').default;
type HyperProps = React.ComponentProps<HyperComponent>;

let Hyper: HyperComponent;
let cleanupHappyDom: (() => void) | null = null;

beforeAll(async () => {
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
  transportMock.on.mockClear();
  transportMock.off.mockClear();
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

describe('Hyper transport subscription lifecycle', () => {
  test.serial('subscribes to term selectAll on mount via transport', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(Hyper, buildHyperProps()));
      await waitFor(0);
    });

    expect(transportMock.on).toHaveBeenCalledWith('term selectAll', expect.any(Function));

    await act(async () => {
      root.unmount();
    });
  });

  test.serial('unsubscribes from term selectAll on unmount via transport', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(Hyper, buildHyperProps()));
      await waitFor(0);
    });

    await act(async () => {
      root.unmount();
      await waitFor(0);
    });

    expect(transportMock.off).toHaveBeenCalledWith('term selectAll', expect.any(Function));
  });

  test.serial('uses the same listener reference for on and off', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(Hyper, buildHyperProps()));
      await waitFor(0);
    });

    const onCall = transportMock.on.mock.calls.find(([event]: [string]) => event === 'term selectAll');
    const onListener = onCall?.[1];

    await act(async () => {
      root.unmount();
      await waitFor(0);
    });

    const offCall = transportMock.off.mock.calls.find(([event]: [string]) => event === 'term selectAll');
    const offListener = offCall?.[1];

    expect(onListener).toBe(offListener);
  });
});
