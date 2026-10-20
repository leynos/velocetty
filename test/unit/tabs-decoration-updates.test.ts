/** @file Verifies tab decoration refreshes are driven by subscribed update events. */
import React, {act} from 'react';
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';

import {afterEach, beforeEach, expect, mock, test} from 'bun:test';

import {createTabsComponent} from '../../lib/components/tabs-component';
import {setupHappyDom} from '../testUtils/happy-dom';
import {waitFor} from '../testUtils/wait-for';
import type {TabsProps, TabProps} from '../../typings/hyper';

type DecoratedTabProps = TabProps & {tabIndex: number};
type DecoratedTab = TabsProps['tabs'][number] & {tabIndex: number};
const getTabPropsMock = mock(<Props extends DecoratedTabProps>(_: DecoratedTab, __: TabsProps, props: Props) => props);
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
    getTabProps: <Props extends DecoratedTabProps>(tab: DecoratedTab, parentProps: TabsProps, props: Props) => {
      getTabPropsMock(tab, parentProps, props);
      return props;
    },
    subscribeTabDecorationUpdates: (listener: () => void) => {
      decorationListener = listener;
      return unsubscribeDecorationUpdates;
    },
    DropdownButton: () => null
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
