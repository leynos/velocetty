/**
 * @file Verifies translated ARIA labels in the header view exported from
 * `lib/containers/header.ts`.
 *
 * Invariants:
 * - The translation fixture must continue to expose stable ARIA label strings
 *   for the menu and window-control buttons.
 * - The rendered header must inject those translated labels into the expected
 *   button controls when the header is mounted in Happy DOM.
 *
 * Cross-links:
 * - Container: `lib/containers/header.ts`
 * - Translation hook usage: `lib/hooks/use-translation.ts`
 */
import React from 'react';
import type {HeaderConnectedProps} from '../../typings/hyper';
import {createRoot} from 'react-dom/client';
import {act} from 'react';

import {afterEach, beforeEach, expect, mock, test} from 'bun:test';

import {setupHappyDom} from '../testUtils/happy-dom';
import {registerPluginsModuleMocks} from '../testUtils/plugins-mock';
import {waitFor} from '../testUtils/waitFor';

type HeaderWithTranslationComponent = typeof import('../../lib/containers/header.ts').HeaderWithTranslation;

const translatedLabels = {
  openMenuAria: 'Open menu',
  minimizeWindowAria: 'Minimise window',
  maximizeWindowAria: 'Maximise window',
  restoreWindowAria: 'Restore window',
  closeWindowAria: 'Close window'
};

type MockProfileCollection = {
  name: string;
  config: Record<string, unknown>;
}[] & {asMutable: () => MockProfileCollection};

const makeProfiles = (): MockProfileCollection => {
  const profiles = [{name: 'default', config: {}}];
  return Object.assign(profiles, {
    asMutable: () => profiles
  });
};

const makeHeaderProps = (overrides: Partial<HeaderConnectedProps> = {}): HeaderConnectedProps => ({
  isMac: false,
  tabs: [{uid: 'tab-1', title: 'Shell', isActive: true, hasActivity: false}],
  activeMarkers: {},
  borderColor: '#555',
  backgroundColor: '#111',
  maximized: false,
  fullScreen: false,
  showHamburgerMenu: '',
  showWindowControls: '',
  defaultProfile: 'default',
  profiles: overrides.profiles ?? makeProfiles(),
  onCloseTab: () => {},
  onChangeTab: () => {},
  maximize: () => {},
  unmaximize: () => {},
  openHamburgerMenu: () => {},
  minimize: () => {},
  close: () => {},
  openNewTab: () => {},
  ...overrides
});

let HeaderWithTranslation: HeaderWithTranslationComponent;
let cleanupHappyDom: (() => void) | null = null;
let windowRequireDescriptor: PropertyDescriptor | undefined;
let hadWindowRequireMock = false;
let moduleInstanceCounter = 0;

const restoreWindowRequire = () => {
  const windowApi = globalThis.window as (Window & {require?: (moduleId: string) => unknown}) | undefined;
  if (!windowApi) {
    return;
  }

  if (windowRequireDescriptor) {
    Object.defineProperty(windowApi, 'require', windowRequireDescriptor);
    windowRequireDescriptor = undefined;
    hadWindowRequireMock = false;
    return;
  }

  if (hadWindowRequireMock) {
    delete (windowApi as {require?: (moduleId: string) => unknown}).require;
    hadWindowRequireMock = false;
  }
};

const registerHeaderWithTranslationMocks = () => {
  const windowApi = globalThis.window as Window & {require?: (moduleId: string) => unknown};
  const mockedIpcRenderer = {
    invoke: mock(async () => ({})),
    on: mock(() => {}),
    send: mock(() => {}),
    removeAllListeners: mock(() => {}),
    removeListener: mock(() => {})
  };

  if (windowApi) {
    windowRequireDescriptor = Object.getOwnPropertyDescriptor(windowApi, 'require');
    Object.defineProperty(windowApi, 'require', {
      configurable: true,
      value: (moduleName: string) => {
        if (moduleName !== 'electron') {
          throw new Error(`Unexpected require in test: ${moduleName}`);
        }
        return {
          ipcRenderer: mockedIpcRenderer
        };
      }
    });
    hadWindowRequireMock = true;
  }

  mock.module('electron', () => ({
    ipcRenderer: mockedIpcRenderer
  }));

  registerPluginsModuleMocks();

  mock.module('../../lib/components/tabs', () => ({default: () => null}));
  mock.module('../../lib/components/tabs.tsx', () => ({default: () => null}));
};

const loadHeaderWithTranslation = async () => {
  mock.restore();
  cleanupHappyDom?.();
  cleanupHappyDom = null;
  cleanupHappyDom = await setupHappyDom();
  registerHeaderWithTranslationMocks();
  moduleInstanceCounter += 1;
  ({HeaderWithTranslation} = await import(
    `../../lib/containers/header.ts?header-with-translation=${moduleInstanceCounter}`
  ));
};

beforeEach(async () => {
  await loadHeaderWithTranslation();
});

afterEach(() => {
  try {
    restoreWindowRequire();
  } finally {
    cleanupHappyDom?.();
    cleanupHappyDom = null;
    mock.restore();
  }
});

const renderHeaderWithTranslation = async (overrides: Partial<HeaderConnectedProps> = {}) => {
  const container = document.createElement('div');
  const root = createRoot(container);
  const props = makeHeaderProps(overrides);

  await act(async () => {
    root.render(React.createElement(HeaderWithTranslation, props));
    await waitFor(0);
  });

  return {container, root};
};

test('injects translated window-control and menu aria labels', async () => {
  const {container, root} = await renderHeaderWithTranslation();

  expect(container.querySelector(`button[aria-label="${translatedLabels.openMenuAria}"]`)).toBeTruthy();
  expect(container.querySelector(`button[aria-label="${translatedLabels.minimizeWindowAria}"]`)).toBeTruthy();
  expect(container.querySelector(`button[aria-label="${translatedLabels.maximizeWindowAria}"]`)).toBeTruthy();
  expect(container.querySelector(`button[aria-label="${translatedLabels.restoreWindowAria}"]`)).toBeNull();
  expect(container.querySelector(`button[aria-label="${translatedLabels.closeWindowAria}"]`)).toBeTruthy();

  await act(async () => {
    root.unmount();
    await waitFor(0);
  });
});

test('uses restore label when window is maximized', async () => {
  const {container, root} = await renderHeaderWithTranslation({maximized: true});

  expect(container.querySelector(`button[aria-label="${translatedLabels.restoreWindowAria}"]`)).toBeTruthy();
  expect(container.querySelector(`button[aria-label="${translatedLabels.maximizeWindowAria}"]`)).toBeNull();

  await act(async () => {
    root.unmount();
    await waitFor(0);
  });
});
