/**
 * @file Verifies that opening and activating the settings tab never disturbs a
 * terminal session.
 *
 * A remount would create a new xterm instance and refit the PTY; a display
 * change would resize it. The test therefore asserts that the terms container
 * stays mounted as the same element, that its layer keeps the explicit
 * full-size class, and that activation only adds the offscreen class and
 * `inert`.
 */
import React, {act} from 'react';
import {flushSync} from 'react-dom';
import {createRoot, type Root} from 'react-dom/client';

import {afterEach, beforeEach, describe, expect, test} from 'bun:test';

import type {HyperProps} from '../../typings/hyper';
import {createCommandRegistryModuleStub} from '../testUtils/command-registry-mock';
import {setupHappyDom} from '../testUtils/happy-dom';
import {registerModuleMock} from '../testUtils/mock-module';
import {registerPluginsModuleMocks} from '../testUtils/plugins-mock';
import {createTransportMock} from '../testUtils/transport-mock';
import {waitFor} from '../testUtils/wait-for';

type TermsRef = {
  getTermByUid: (uid: string) => {focus: () => void} | null;
  getActiveTerm: () => {focus: () => void} | null;
};

let Hyper: React.ComponentType<HyperProps>;
let cleanup: (() => void) | null = null;
let root: Root | null = null;
let containerMounted = 0;
let moduleInstance = 0;

const {transportMock} = createTransportMock();

const registerMocks = () => {
  // Only the transport is replaced. Bun's module-mock registry is process-wide,
  // so a partial `lib/actions/ui` mock would remove the real action creators
  // for every suite that runs after this one. The container renders without
  // dispatching, and its UI action imports reach the transport this mock
  // supplies, so the real module is safe here.
  registerModuleMock('../../lib/transport', () => ({transport: transportMock}));
  registerModuleMock('../../lib/transport/electron-ipc-transport', () => ({transport: transportMock}));
  registerPluginsModuleMocks({}, {defaultExportMode: 'self'});
  registerModuleMock('../../lib/containers/header', () => ({HeaderContainer: () => null}));
  registerModuleMock('../../lib/containers/notifications', () => ({default: () => null}));
  registerModuleMock('../../lib/containers/settings', () => ({
    default: () => React.createElement('div', {id: 'settings'})
  }));
  registerModuleMock('../../lib/containers/terms', () => ({
    default: (props: {ref_: (terms: TermsRef) => void}) => {
      // Count mounts, not renders: a remount is what would replace the xterm
      // instance and refit the PTY.
      React.useEffect(() => {
        containerMounted += 1;
      }, []);
      props.ref_({getTermByUid: () => null, getActiveTerm: () => null});
      return React.createElement('div', {id: 'terms'});
    }
  }));
  registerModuleMock('mousetrap', () => ({default: () => ({bind() {}, reset() {}})}));
  registerModuleMock('../../lib/command-registry', () => ({
    createCommandRegistryModule: () => createCommandRegistryModuleStub(),
    getRegisteredKeys: async () => ({}),
    getCommandHandler: () => {
      // No command handlers are needed to render the shell.
    },
    shouldPreventDefault: () => false
  }));
};

// SAFETY: the test sets every property Hyper reads; the cast only fills
// extension props that a window normally supplies.
const baseProps: HyperProps = {
  isMac: false,
  customCSS: '',
  uiFontFamily: 'Menlo',
  borderColor: '#000',
  backgroundColor: '#111',
  activeSession: null,
  isSettingsSurfaceActive: false,
  isSettingsOpen: true,
  maximized: false,
  fullScreen: false,
  lastConfigUpdate: null,
  execCommand: () => {}
};

const render = async (overrides: Partial<HyperProps>): Promise<void> => {
  if (!root) {
    const element = document.createElement('div');
    document.body.append(element);
    root = createRoot(element);
  }
  await act(async () => {
    flushSync(() => {
      root?.render(React.createElement(Hyper, {...baseProps, ...overrides}));
    });
  });
};

const termsLayer = (): HTMLElement | null => document.querySelector('#terms')?.parentElement ?? null;
const settingsLayer = (): HTMLElement | null => document.querySelector('#settings')?.parentElement ?? null;

beforeEach(async () => {
  cleanup = await setupHappyDom();
  containerMounted = 0;
  moduleInstance += 1;
  registerMocks();
  ({default: Hyper} = await import(`../../lib/containers/hyper.tsx?terminal_preservation=${moduleInstance}`));
  await act(async () => {
    await waitFor(0);
  });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  cleanup?.();
  cleanup = null;
});

describe('settings tab and terminal preservation', () => {
  test('activation moves the terms layer offscreen without remounting it', async () => {
    await render({isSettingsSurfaceActive: false});
    await act(async () => {
      await waitFor(0);
    });
    const before = termsLayer();
    const mountsBefore = containerMounted;
    expect(before).not.toBeNull();
    expect(before?.className).toContain('surfaceLayer');
    expect(before?.className).not.toContain('surfaceLayerOffscreen');
    expect(before?.hasAttribute('inert')).toBe(false);

    await render({isSettingsSurfaceActive: true});
    await act(async () => {
      await waitFor(0);
    });
    const after = termsLayer();
    expect(after).toBe(before);
    expect(containerMounted).toBe(mountsBefore);
    expect(after?.className).toContain('surfaceLayer');
    expect(after?.className).toContain('surfaceLayerOffscreen');
    expect(after?.hasAttribute('inert')).toBe(true);
  });

  test('the settings layer is visible and interactive only while the surface is active', async () => {
    await render({isSettingsSurfaceActive: false});
    await act(async () => {
      await waitFor(0);
    });
    expect(settingsLayer()?.className).toContain('surfaceLayerOffscreen');
    // The hidden settings form must not be reachable by keyboard or assistive
    // technology while the terminal owns input, mirroring the terminal layer.
    expect(settingsLayer()?.hasAttribute('inert')).toBe(true);

    await render({isSettingsSurfaceActive: true});
    await act(async () => {
      await waitFor(0);
    });
    expect(settingsLayer()?.className).not.toContain('surfaceLayerOffscreen');
    expect(settingsLayer()?.hasAttribute('inert')).toBe(false);
  });

  test('closing settings removes only the settings layer', async () => {
    await render({isSettingsSurfaceActive: true});
    await act(async () => {
      await waitFor(0);
    });
    expect(termsLayer()).not.toBeNull();

    await render({isSettingsSurfaceActive: false, isSettingsOpen: false});
    await act(async () => {
      await waitFor(0);
    });
    expect(document.querySelector('#settings')).toBeNull();
    expect(document.querySelector('#terms')).not.toBeNull();
    expect(termsLayer()?.hasAttribute('inert')).toBe(false);
  });
});
