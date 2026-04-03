/** @file Verifies new-tab class-name assembly without duplicate spaces, Escape-key dismissal behaviour, preventDefault handling, and focus-boundary closing. */
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';

import {expect, test} from 'bun:test';

import {setupHappyDom} from '../testUtils/happy-dom';
import {waitFor} from '../testUtils/waitFor';

type NewTabComponent = typeof import('../../lib/components/new-tab').default;

const renderNewTab = async () => {
  const cleanup = await setupHappyDom();
  const {default: NewTab} = (await import(`../../lib/components/new-tab.tsx?new_tab_test=${Date.now()}`)) as {
    default: NewTabComponent;
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

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
