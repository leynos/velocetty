/** @file Exercises notification timing and dismissal behaviour. */
import React from 'react';
import {createRoot} from 'react-dom/client';
// react-dom/test-utils is required until React 18.3+ exposes act from react.
import {act} from 'react-dom/test-utils';

import test from 'ava';

import Notification from '../../lib/components/notification';
import {setupHappyDom} from '../testUtils/happy-dom';

const waitFor = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test.serial('Notification auto-dismisses after the timeout on mount', async (t) => {
  const cleanup = setupHappyDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  let dismissCount = 0;
  await act(async () => {
    root.render(
      React.createElement(Notification, {
        backgroundColor: '#000',
        dismissAfter: 10,
        onDismiss: () => dismissCount++,
        text: 'Hello'
      })
    );
  });

  await waitFor(15);
  const indicator = container.querySelector('.notification_indicator');
  t.truthy(indicator);
  if (!indicator) {
    t.fail('Expected notification indicator to be present.');
  } else {
    indicator.dispatchEvent(new Event('webkitTransitionEnd'));
  }

  t.is(dismissCount, 1);

  root.unmount();
  cleanup();
});

test.serial('Notification resets the timer when text changes', async (t) => {
  const cleanup = setupHappyDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  let dismissCount = 0;
  await act(async () => {
    root.render(
      React.createElement(Notification, {
        backgroundColor: '#000',
        dismissAfter: 20,
        onDismiss: () => dismissCount++,
        text: 'First'
      })
    );
  });

  await waitFor(10);
  await act(async () => {
    root.render(
      React.createElement(Notification, {
        backgroundColor: '#000',
        dismissAfter: 20,
        onDismiss: () => dismissCount++,
        text: 'Second'
      })
    );
  });

  await waitFor(12);
  const indicator = container.querySelector('.notification_indicator');
  t.truthy(indicator);
  if (!indicator) {
    t.fail('Expected notification indicator to be present.');
  } else {
    indicator.dispatchEvent(new Event('webkitTransitionEnd'));
  }
  t.is(dismissCount, 0);

  await waitFor(12);
  if (!indicator) {
    t.fail('Expected notification indicator to be present.');
  } else {
    indicator.dispatchEvent(new Event('webkitTransitionEnd'));
  }
  t.is(dismissCount, 1);

  root.unmount();
  cleanup();
});
