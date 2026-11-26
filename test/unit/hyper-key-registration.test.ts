/**
 * @file Hyper's asynchronous key-registration race.
 *
 * `attachKeyListeners` waits for the command registry, so a re-render can
 * start a newer attachment while an older one is still pending. Binding the
 * older answer afterwards would restore keys the newer configuration removed,
 * and binding after unmount would write into a mousetrap that no longer has a
 * window. The registration id is what makes both cases observable here.
 */
import React, {act} from 'react';
import {flushSync} from 'react-dom';
import {createRoot, type Root} from 'react-dom/client';

import {afterEach, beforeEach, expect, mock, test} from 'bun:test';

import type {HyperProps} from '../../typings/hyper';
import {createCommandRegistryModuleStub} from '../testUtils/command-registry-mock';
import {setupHappyDom} from '../testUtils/happy-dom';
import {registerModuleMock} from '../testUtils/mock-module';
import {registerPluginsModuleMocks} from '../testUtils/plugins-mock';
import {createTransportMock} from '../testUtils/transport-mock';
import {waitFor} from '../testUtils/wait-for';

type RegisteredKeyMap = {[commandKeys: string]: string};
type TermsRef = {
  getTermByUid: (uid: string) => {focus: () => void} | null;
  getActiveTerm: () => {focus: () => void} | null;
};

let Hyper: React.ComponentType<HyperProps>;
let cleanup: (() => void) | null = null;
let root: Root | null = null;
let moduleInstance = 0;
let bindCalls = 0;
let boundKeys: string[] = [];
/** When set, each `getRegisteredKeys` call waits for the test to settle it. */
let keyLoadQueue: Array<(keys: RegisteredKeyMap) => void> | null = null;

const {transportMock} = createTransportMock();

/**
 * Mousetrap double that records the bindings, not just their count.
 *
 * `reset` clears them because the real mousetrap drops its bindings; a stale
 * rebind is then visible as an extra key rather than hidden by the newer set.
 */
const MousetrapMock = () => ({
  bind(keys: string, _handler: () => void) {
    bindCalls += 1;
    boundKeys.push(keys);
  },
  reset() {
    boundKeys = [];
  }
});

const buildProps = (overrides: Partial<HyperProps> = {}): HyperProps => ({
  isSettingsOpen: false,
  isSettingsSurfaceActive: false,
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

const renderHyper = (overrides: Partial<HyperProps>) => {
  if (!root) {
    const element = document.createElement('div');
    document.body.append(element);
    root = createRoot(element);
  }
  flushSync(() => {
    root?.render(React.createElement(Hyper, buildProps(overrides)));
  });
};

const registerMocks = () => {
  // Only the modules Hyper itself reaches are replaced. The registry is the
  // seam under test; everything else is a passive stub.
  registerModuleMock('../../lib/transport', () => ({transport: transportMock}));
  registerModuleMock('../../lib/transport/electron-ipc-transport', () => ({transport: transportMock}));
  registerModuleMock('../../lib/actions/ui', () => ({
    execCommand: () => ({type: 'exec'}),
    setFontSmoothing: () => ({type: 'UI_SET_FONT_SMOOTHING'})
  }));
  registerPluginsModuleMocks({}, {defaultExportMode: 'self'});
  registerModuleMock('../../lib/containers/header', () => ({HeaderContainer: () => null}));
  registerModuleMock('../../lib/containers/notifications', () => ({default: () => null}));
  registerModuleMock('../../lib/containers/terms', () => ({
    default: (props: {ref_: (terms: TermsRef | null) => void}) => {
      props.ref_({getTermByUid: () => null, getActiveTerm: () => null});
      return null;
    }
  }));
  registerModuleMock('mousetrap', () => ({default: MousetrapMock}));
  registerModuleMock('../../lib/command-registry', () => ({
    createCommandRegistryModule: () => createCommandRegistryModuleStub(),
    getRegisteredKeys: async () => {
      if (keyLoadQueue) {
        return await new Promise<RegisteredKeyMap>((resolve) => {
          keyLoadQueue?.push(resolve);
        });
      }
      return {};
    },
    getCommandHandler: () => {},
    shouldPreventDefault: () => false
  }));
};

beforeEach(async () => {
  bindCalls = 0;
  boundKeys = [];
  keyLoadQueue = null;
  cleanup = await setupHappyDom();
  moduleInstance += 1;
  registerMocks();
  ({default: Hyper} = await import(`../../lib/containers/hyper.tsx?key_registration=${moduleInstance}`));
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  cleanup?.();
  cleanup = null;
  mock.restore();
});

const noOpCommand = () => {};

test.serial('a key registration that settles after a newer one binds nothing', async () => {
  const pending: Array<(keys: RegisteredKeyMap) => void> = [];
  keyLoadQueue = pending;

  await act(async () => {
    renderHyper({execCommand: noOpCommand, lastConfigUpdate: 1});
    await waitFor(0);
  });
  await act(async () => {
    renderHyper({execCommand: noOpCommand, lastConfigUpdate: 2});
    await waitFor(0);
  });

  expect(pending).toHaveLength(2);
  // SAFETY: the assertion above proves both renders queued a settlement, so
  // the two entries exist and are the resolver functions this test supplied.
  const [stale, current] = pending as [(keys: RegisteredKeyMap) => void, (keys: RegisteredKeyMap) => void];

  // The newer registration settles first and binds its keys.
  await act(async () => {
    current({fresh: 'tab:new'});
    await waitFor(0);
  });
  expect(boundKeys).toEqual(['fresh']);

  // The older answer arriving afterwards must not bind again.
  await act(async () => {
    stale({stale: 'editor:paste'});
    await waitFor(0);
  });
  expect(boundKeys).toEqual(['fresh']);
  expect(bindCalls).toBe(1);
});

test.serial('a key registration that settles after unmount binds nothing', async () => {
  const pending: Array<(keys: RegisteredKeyMap) => void> = [];
  keyLoadQueue = pending;

  await act(async () => {
    renderHyper({execCommand: noOpCommand});
    await waitFor(0);
  });
  expect(pending).toHaveLength(1);

  await act(async () => {
    root?.unmount();
    pending[0]?.({late: 'tab:new'});
    await waitFor(0);
  });

  expect(bindCalls).toBe(0);
});
