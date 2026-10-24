/** @file Verifies tab decoration refreshes are driven by subscribed update events. */
import React, {act} from 'react';
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';

import {afterEach, beforeEach, expect, mock, test} from 'bun:test';

import {createTabsComponent} from '../../lib/components/tabs-component';
import type {getTabProps as getTabPropsContract} from '../../lib/utils/plugins';
import {setupHappyDom} from '../testUtils/happy-dom';
import {waitFor} from '../testUtils/wait-for';

/**
 * Records tab-decoration lookups.
 *
 * Only `tabIndex` is read back, so the double takes the narrowest shape that
 * carries it rather than the full production parameter list; the double handed
 * to `createTabsComponent` below takes its parameter types from the real
 * `getTabProps` instead.
 */
const getTabPropsMock = mock((_tab: {tabIndex: number}, _parentProps: unknown, props: unknown) => props);

/**
 * Double for the plugin-decorated lookup, typed by the production signature.
 *
 * It adds the two fields the real `getTabProps` always contributes — an empty
 * decoration and the strip position — rather than returning `props` untouched.
 * That is the shape callers receive, and returning less would make this double
 * stricter than the contract it stands in for.
 */
const buildGetTabProps = (): typeof getTabPropsContract => (tab, parentProps, props) => {
  getTabPropsMock(tab, parentProps, props);
  return {...props, tabDecoration: {}, tabIndex: tab.tabIndex};
};
const unsubscribeDecorationUpdates = mock(() => {
  decorationListener = null;
});
let decorationListener: (() => void) | null = null;

type TabsComponent = ReturnType<typeof createTabsComponent>;

let Tabs: TabsComponent;
let cleanupHappyDom: (() => void) | null = null;
const loadTabsComponent = async () => {
  cleanupHappyDom = await setupHappyDom();
  Tabs = createTabsComponent({
    decorate: (Component) => Component,
    getTabProps: buildGetTabProps(),
    subscribeTabDecorationUpdates: (listener: () => void) => {
      decorationListener = listener;
      return unsubscribeDecorationUpdates;
    },
    // The strip only needs a placeholder button; it must render something,
    // because the dependency is typed as the real component.
    DropdownButton: () => React.createElement('span')
  });
};

beforeEach(async () => {
  decorationListener = null;
  getTabPropsMock.mockClear();
  unsubscribeDecorationUpdates.mockClear();
  await loadTabsComponent();
});

afterEach(() => {
  try {
    cleanupHappyDom?.();
  } finally {
    cleanupHappyDom = null;
    mock.restore();
  }
});

const mountTabs = async (root: ReturnType<typeof createRoot>) => {
  await act(async () => {
    flushSync(() => {
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
    });
    await waitFor(0);
  });
};

test('re-renders tabs when provider update callback fires', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await mountTabs(root);
  expect(decorationListener).toEqual(expect.any(Function));
  expect(getTabPropsMock).toHaveBeenCalledTimes(2);
  expect(getTabPropsMock.mock.calls[0]?.[0].tabIndex).toBe(0);
  expect(getTabPropsMock.mock.calls[1]?.[0].tabIndex).toBe(1);

  await act(async () => {
    flushSync(() => {
      decorationListener?.();
    });
    await waitFor(0);
  });

  expect(getTabPropsMock).toHaveBeenCalledTimes(4);
  expect(getTabPropsMock.mock.calls[2]?.[0].tabIndex).toBe(0);
  expect(getTabPropsMock.mock.calls[3]?.[0].tabIndex).toBe(1);

  await act(async () => {
    root.unmount();
    await waitFor(0);
  });

  expect(unsubscribeDecorationUpdates).toHaveBeenCalledTimes(1);
});
