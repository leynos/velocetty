/** @file Verifies new-tab class name assembly stays free of duplicate spaces. */
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';

import {expect, test} from 'bun:test';

import {setupHappyDom} from '../testUtils/happy-dom';
import {waitFor} from '../testUtils/waitFor';

type NewTabComponent = typeof import('../../lib/components/new-tab').default;

test('filters empty class name segments for the button and menu items', async () => {
  const cleanup = await setupHappyDom();
  const {default: NewTab} = (await import(`../../lib/components/new-tab.tsx?new_tab_test=${Date.now()}`)) as {
    default: NewTabComponent;
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(NewTab, {
          defaultProfile: 'default',
          profiles: [
            {name: 'default', config: {}},
            {name: 'secondary', config: {}}
          ],
          openNewTab: () => {},
          backgroundColor: '#000',
          borderColor: '#333',
          tabsVisible: false
        })
      );
      await waitFor(0);
    });

    const button = container.querySelector('button');
    expect(button).toBeTruthy();
    expect(button?.className.includes('  ')).toBe(false);

    await act(async () => {
      button?.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
      await waitFor(0);
    });

    const menuItems = Array.from(container.querySelectorAll('button[role="menuitem"]'));
    expect(menuItems.length).toBe(2);
    expect(menuItems.every((item) => !item.className.includes('  '))).toBe(true);
  } finally {
    await act(async () => {
      root.unmount();
      await waitFor(0);
    });
    cleanup();
  }
});
