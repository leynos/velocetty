/** @file Verifies translated ARIA labels are injected into the header view. */
import React from 'react';
import type {HeaderConnectedProps} from '../../typings/hyper';
import {createRoot} from 'react-dom/client';
import {act} from 'react';

import {afterEach, beforeEach, expect, mock, test} from 'bun:test';

import {setupHappyDom} from '../testUtils/happy-dom';
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

  mock.module('../../lib/utils/plugins', () => ({
    connect: () => (Component: unknown) => Component,
    decorate: (Component: unknown) => Component,
    getTabProps: (_tab: unknown, _parentProps: unknown, props: unknown) => props,
    getTabsProps: (_parentProps: unknown, props: unknown) => props,
    subscribeTabDecorationUpdates: () => () => {}
  }));
  mock.module('../../lib/utils/plugins.ts', () => ({
    connect: () => (Component: unknown) => Component,
    decorate: (Component: unknown) => Component,
    getTabProps: (_tab: unknown, _parentProps: unknown, props: unknown) => props,
    getTabsProps: (_parentProps: unknown, props: unknown) => props,
    subscribeTabDecorationUpdates: () => () => {}
  }));

  mock.module('../../lib/components/tabs', () => ({default: () => null}));
  mock.module('../../lib/components/tabs.tsx', () => ({default: () => null}));
};

const loadHeaderWithTranslation = async () => {
  mock.restore();
  cleanupHappyDom?.();
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
    mock.restore();
  }
});

const renderHeaderWithTranslation = async () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  const props: HeaderConnectedProps = {
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
    profiles: makeProfiles(),
    onCloseTab: () => {},
    onChangeTab: () => {},
    maximize: () => {},
    unmaximize: () => {},
    openHamburgerMenu: () => {},
    minimize: () => {},
    close: () => {},
    openNewTab: () => {}
  };

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
  expect(container.querySelector(`button[aria-label="${translatedLabels.closeWindowAria}"]`)).toBeTruthy();

  await act(async () => {
    root.unmount();
    await waitFor(0);
  });
});

test('uses restore label when window is maximized', async () => {
  const container = document.createElement('div');
  const root = createRoot(container);

  await act(async () => {
    root.render(
      React.createElement(HeaderWithTranslation, {
        isMac: false,
        tabs: [{uid: 'tab-1', title: 'Shell', isActive: true, hasActivity: false}],
        activeMarkers: {},
        borderColor: '#555',
        backgroundColor: '#111',
        maximized: true,
        fullScreen: false,
        showHamburgerMenu: '',
        showWindowControls: '',
        defaultProfile: 'default',
        profiles: makeProfiles(),
        onCloseTab: () => {},
        onChangeTab: () => {},
        maximize: () => {},
        unmaximize: () => {},
        openHamburgerMenu: () => {},
        minimize: () => {},
        close: () => {},
        openNewTab: () => {}
      } satisfies HeaderConnectedProps)
    );
    await waitFor(0);
  });

  expect(container.querySelector(`button[aria-label="${translatedLabels.restoreWindowAria}"]`)).toBeTruthy();

  await act(async () => {
    root.unmount();
    await waitFor(0);
  });
});
