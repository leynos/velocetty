/** @file Exercises notification timing and dismissal behaviour. */
import React from 'react';
import {createRoot} from 'react-dom/client';
// react-dom/test-utils is required until React 18.3+ exposes act from react.
import {act} from 'react-dom/test-utils';

import {expect, test} from 'bun:test';

import Notification from '../../lib/components/notification';
import {setupHappyDom} from '../testUtils/happy-dom';

const waitFor = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const dispatchOpacityTransition = (indicator: Element) => {
  const event = new Event('transitionend') as TransitionEvent;
  Object.defineProperty(event, 'propertyName', {value: 'opacity'});
  Object.defineProperty(event, 'target', {value: indicator});
  indicator.dispatchEvent(event);
};

test.serial('Notification auto-dismisses after the timeout on mount', async () => {
  const cleanup = await setupHappyDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  let dismissCount = 0;
  const dismissAfterMs = 60;
  const bufferMs = 60;
  await act(async () => {
    root.render(
      React.createElement(Notification, {
        backgroundColor: '#000',
        dismissAfter: dismissAfterMs,
        onDismiss: () => dismissCount++,
        text: 'Hello'
      })
    );
  });

  await act(async () => {
    await waitFor(dismissAfterMs + bufferMs);
  });
  const indicator = container.querySelector('.notification_indicator');
  expect(indicator).toBeTruthy();
  if (!indicator) {
    throw new Error('Expected notification indicator to be present.');
  } else {
    await act(async () => {
      dispatchOpacityTransition(indicator);
    });
  }

  expect(dismissCount).toBe(1);

  root.unmount();
  cleanup();
});

test.serial('Notification resets the timer when text changes', async () => {
  const cleanup = await setupHappyDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  let dismissCount = 0;
  const dismissAfterMs = 80;
  await act(async () => {
    root.render(
      React.createElement(Notification, {
        backgroundColor: '#000',
        dismissAfter: dismissAfterMs,
        onDismiss: () => dismissCount++,
        text: 'First'
      })
    );
  });

  await act(async () => {
    await waitFor(40);
  });
  await act(async () => {
    root.render(
      React.createElement(Notification, {
        backgroundColor: '#000',
        dismissAfter: dismissAfterMs,
        onDismiss: () => dismissCount++,
        text: 'Second'
      })
    );
  });

  await act(async () => {
    await waitFor(50);
  });
  const indicator = container.querySelector('.notification_indicator');
  expect(indicator).toBeTruthy();
  if (!indicator) {
    throw new Error('Expected notification indicator to be present.');
  } else {
    await act(async () => {
      dispatchOpacityTransition(indicator);
    });
  }
  expect(dismissCount).toBe(0);

  await act(async () => {
    await waitFor(40);
  });
  if (!indicator) {
    throw new Error('Expected notification indicator to be present.');
  } else {
    await act(async () => {
      dispatchOpacityTransition(indicator);
    });
  }
  expect(dismissCount).toBe(1);

  root.unmount();
  cleanup();
});
