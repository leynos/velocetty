/**
 * @file Verifies new-tab class-name assembly without duplicate spaces, Escape-key
 * dismissal behaviour, preventDefault handling, and focus-boundary closing.
 */
import React, {act} from 'react';
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';

import {expect, test} from 'bun:test';

import {setupHappyDom} from '../testUtils/happy-dom';
import {waitFor} from '../testUtils/waitFor';

type NewTabComponent = typeof import('../../lib/components/new-tab').default;

const renderNewTab = async () => {
  const cleanup = await setupHappyDom();
  // Bun's ESM loader caches modules aggressively. A unique `?new_tab_test=`
  // query string is appended here to force a fresh module evaluation for each
  // test run; keep in mind this pattern is Bun-specific and may need adjustment
  // for other runners.
  const {default: NewTab} = (await import(`../../lib/components/new-tab.tsx?new_tab_test=${Date.now()}`)) as {
    default: NewTabComponent;
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    flushSync(() => {
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
    });
    await waitFor(0);
  });

  return {cleanup, container, root};
};

test('filters empty class name segments for the button and menu items', async () => {
  const {cleanup, container, root} = await renderNewTab();

  try {
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

test('closes the dropdown when Escape is pressed', async () => {
  const {cleanup, container, root} = await renderNewTab();

  try {
    const button = container.querySelector('button');
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
      await waitFor(0);
    });

    expect(container.querySelector('[role="menu"]')).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new window.KeyboardEvent('keydown', {bubbles: true, key: 'Escape'}));
      await waitFor(0);
    });

    expect(container.querySelector('[role="menu"]')).toBeNull();
  } finally {
    await act(async () => {
      root.unmount();
      await waitFor(0);
    });
    cleanup();
  }
});

test('prevents the default Escape key action when closing the dropdown', async () => {
  const {cleanup, container, root} = await renderNewTab();

  try {
    const button = container.querySelector('button');
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
      await waitFor(0);
    });

    const escapeEvent = new window.KeyboardEvent('keydown', {bubbles: true, cancelable: true, key: 'Escape'});

    await act(async () => {
      button?.dispatchEvent(escapeEvent);
      await waitFor(0);
    });

    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(container.querySelector('[role="menu"]')).toBeNull();
  } finally {
    await act(async () => {
      root.unmount();
      await waitFor(0);
    });
    cleanup();
  }
});

test('closes the dropdown when focus leaves the component boundary', async () => {
  const {cleanup, container, root} = await renderNewTab();
  let outsideButton: HTMLButtonElement | null = null;

  try {
    const button = container.querySelector('button');
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
      await waitFor(0);
    });

    const dropdown = container.querySelector('[role="menu"]');
    outsideButton = document.createElement('button');
    document.body.appendChild(outsideButton);
    expect(dropdown).toBeTruthy();

    await act(async () => {
      dropdown?.dispatchEvent(new window.FocusEvent('focusout', {bubbles: true, relatedTarget: outsideButton}));
      await waitFor(0);
    });

    expect(container.querySelector('[role="menu"]')).toBeNull();
  } finally {
    outsideButton?.remove();
    await act(async () => {
      root.unmount();
      await waitFor(0);
    });
    cleanup();
  }
});

test('exposes CSS custom properties and CSS Module classes for the trigger and dropdown', async () => {
  const {cleanup, container, root} = await renderNewTab();

  try {
    const button = container.querySelector('button');
    const wrapper = button?.parentElement as HTMLDivElement | null;
    expect(button).toBeTruthy();
    expect(wrapper).toBeTruthy();

    if (!button || !wrapper) {
      throw new Error('Expected new-tab trigger and wrapper to be present');
    }

    expect(button.className).toContain('newTab');
    expect(button.className).not.toContain('  ');
    expect(wrapper.style.getPropertyValue('--new-tab-border')).toBe('#333');
    expect(wrapper.style.getPropertyValue('--new-tab-bg')).toBe('#000');

    await act(async () => {
      button.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
      await waitFor(0);
    });

    const dropdown = container.querySelector<HTMLElement>('[role="menu"]');
    const menuItem = container.querySelector<HTMLButtonElement>('button[role="menuitem"]');
    expect(dropdown).toBeTruthy();
    expect(menuItem).toBeTruthy();

    if (!dropdown || !menuItem) {
      throw new Error('Expected new-tab dropdown and menu item to be present');
    }

    expect(dropdown.className).toContain('profileDropdown');
    expect(menuItem.className).toContain('profileDropdownItem');
  } finally {
    await act(async () => {
      root.unmount();
      await waitFor(0);
    });
    cleanup();
  }
});
