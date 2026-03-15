/** @file Verifies tab decoration refreshes are driven by subscribed update events. */
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';

import {afterEach, beforeEach, expect, mock, spyOn, test} from 'bun:test';

import {setupHappyDom} from '../testUtils/happy-dom';
import {registerPluginsModuleMocks} from '../testUtils/plugins-mock';
import {waitFor} from '../testUtils/waitFor';

type MockTabProps = {
  text?: string;
  tabDecoration?: unknown;
};

const getTabPropsMock = mock((_: unknown, __: unknown, props: MockTabProps) => props);
const unsubscribeDecorationUpdates = mock(() => {
  decorationListener = null;
});
let decorationListener: (() => void) | null = null;

const registerTabsModuleMocks = () => {
  registerPluginsModuleMocks({
    getTabProps: (tab: unknown, parentProps: unknown, props: unknown) => getTabPropsMock(tab, parentProps, props),
    subscribeTabDecorationUpdates: (listener: () => void) => {
      decorationListener = listener;
      return unsubscribeDecorationUpdates;
    }
  });

  mock.module('../../lib/components/new-tab', () => ({
    default: () => null
  }));
};

type TabsComponent = typeof import('../../lib/components/tabs').default;

let Tabs: TabsComponent;
let cleanupHappyDom: (() => void) | null = null;
let moduleInstanceCounter = 0;
let consoleErrorSpy: ReturnType<typeof spyOn> | null = null;

const loadTabsComponent = async () => {
  cleanupHappyDom = await setupHappyDom();
  registerTabsModuleMocks();
  moduleInstanceCounter += 1;
  ({default: Tabs} = await import(`../../lib/components/tabs.tsx?tabs_decoration_updates=${moduleInstanceCounter}`));
};

beforeEach(async () => {
  // Suppress the known React warning about styled-jsx's non-boolean `jsx`
  // attribute. The styled-jsx build transform strips this at build time, but
  // the test environment renders the raw `<style jsx={true}>` into the DOM.
  consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
  decorationListener = null;
  getTabPropsMock.mockClear();
  unsubscribeDecorationUpdates.mockClear();
  await loadTabsComponent();
});

afterEach(() => {
  try {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
    cleanupHappyDom?.();
  } finally {
    cleanupHappyDom = null;
    mock.restore();
  }
});

const mountTabs = async (root: ReturnType<typeof createRoot>) => {
  await act(async () => {
    root.render(
      React.createElement(Tabs, {
        tabs: [
          {uid: 'tab-1', title: 'One', isActive: true, hasActivity: false},
          {uid: 'tab-2', title: 'Two', isActive: false, hasActivity: false}
        ],
        borderColor: '#333',
        backgroundColor: '#000',
        onChange: () => {},
        onClose: () => {},
        fullScreen: false,
        defaultProfile: 'default',
        profiles: [{name: 'default', config: {}}],
        openNewTab: () => {}
      })
    );
    await waitFor(0);
  });
};

test('re-renders tabs when provider update callback fires', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await mountTabs(root);
  expect(typeof decorationListener).toBe('function');
  expect(getTabPropsMock).toHaveBeenCalledTimes(2);
  expect((getTabPropsMock.mock.calls[0]?.[0] as {tabIndex?: number}).tabIndex).toBe(0);
  expect((getTabPropsMock.mock.calls[1]?.[0] as {tabIndex?: number}).tabIndex).toBe(1);

  await act(async () => {
    decorationListener?.();
    await waitFor(0);
  });

  expect(getTabPropsMock).toHaveBeenCalledTimes(4);
  expect((getTabPropsMock.mock.calls[2]?.[0] as {tabIndex?: number}).tabIndex).toBe(0);
  expect((getTabPropsMock.mock.calls[3]?.[0] as {tabIndex?: number}).tabIndex).toBe(1);

  await act(async () => {
    root.unmount();
    await waitFor(0);
  });

  expect(unsubscribeDecorationUpdates).toHaveBeenCalledTimes(1);
});
