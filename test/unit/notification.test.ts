/** @file Exercises notification timing and dismissal behaviour. */
import React from 'react';
import {createRoot} from 'react-dom/client';
// react-dom/test-utils is required until React 18.3+ exposes act from react.
import {act} from 'react-dom/test-utils';

import {expect, test} from 'bun:test';

import Notification from '../../lib/components/notification';
import {setupHappyDom} from '../testUtils/happy-dom';

type NotificationProps = React.ComponentProps<typeof Notification>;

const buildNotificationProps = (
  dismissAfter: number,
  onDismiss: () => void,
  overrides: Partial<NotificationProps> = {}
): NotificationProps => ({
  backgroundColor: '#000',
  dismissAfter,
  onDismiss,
  text: 'Hello',
  ...overrides
});
const dispatchOpacityTransition = (indicator: Element) => {
  const event = new Event('transitionend') as TransitionEvent;
  Object.defineProperty(event, 'propertyName', {value: 'opacity'});
  Object.defineProperty(event, 'target', {value: indicator});
  indicator.dispatchEvent(event);
};
const createFakeTimers = () => {
  let now = 0;
  let nextId = 1;
  let scheduled: Array<{id: number; runAt: number; callback: () => void}> = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  const setTimeoutMock = (callback: () => void, delay = 0) => {
    const id = nextId;
    nextId += 1;
    scheduled.push({id, runAt: now + delay, callback});
    scheduled.sort((a, b) => a.runAt - b.runAt);
    return id as unknown as NodeJS.Timeout;
  };

  const clearTimeoutMock = (handle?: NodeJS.Timeout) => {
    const id = Number(handle);
    scheduled = scheduled.filter((timer) => timer.id !== id);
  };

  const advanceTimersByTime = (ms: number) => {
    const target = now + ms;
    while (scheduled.length > 0 && scheduled[0].runAt <= target) {
      const [nextTimer] = scheduled;
      scheduled = scheduled.slice(1);
      now = nextTimer.runAt;
      nextTimer.callback();
      scheduled.sort((a, b) => a.runAt - b.runAt);
    }
    now = target;
  };

  const install = () => {
    globalThis.setTimeout = setTimeoutMock as typeof globalThis.setTimeout;
    globalThis.clearTimeout = clearTimeoutMock as typeof globalThis.clearTimeout;
  };

  const restore = () => {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  };

  return {advanceTimersByTime, install, restore};
};
const requireIndicator = (container: HTMLElement) => {
  const indicator = container.querySelector('.notification_indicator');
  expect(indicator).toBeTruthy();
  if (!indicator) {
    throw new Error('Expected notification indicator to be present.');
  }
  return indicator;
};

test.serial('Notification auto-dismisses after the timeout on mount', async () => {
  const cleanup = await setupHappyDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  const timers = createFakeTimers();
  timers.install();
  try {
    let dismissCount = 0;
    const dismissAfterMs = 60;
    const bufferMs = 60;
    await act(async () => {
      root.render(
        React.createElement(
          Notification,
          buildNotificationProps(dismissAfterMs, () => {
            dismissCount += 1;
          })
        )
      );
    });

    await act(async () => {
      timers.advanceTimersByTime(dismissAfterMs + bufferMs);
    });
    const indicator = requireIndicator(container);
    await act(async () => {
      dispatchOpacityTransition(indicator);
    });

    expect(dismissCount).toBe(1);
  } finally {
    timers.restore();
    root.unmount();
    cleanup();
  }
});

test.serial('Notification resets the timer when text changes', async () => {
  const cleanup = await setupHappyDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  const timers = createFakeTimers();
  timers.install();
  try {
    let dismissCount = 0;
    const dismissAfterMs = 80;
    const onDismiss = () => {
      dismissCount += 1;
    };
    await act(async () => {
      root.render(
        React.createElement(Notification, buildNotificationProps(dismissAfterMs, onDismiss, {text: 'First'}))
      );
    });

    await act(async () => {
      timers.advanceTimersByTime(40);
    });
    await act(async () => {
      root.render(
        React.createElement(Notification, buildNotificationProps(dismissAfterMs, onDismiss, {text: 'Second'}))
      );
    });

    await act(async () => {
      timers.advanceTimersByTime(50);
    });
    const firstIndicator = requireIndicator(container);
    await act(async () => {
      dispatchOpacityTransition(firstIndicator);
    });
    expect(dismissCount).toBe(0);

    await act(async () => {
      timers.advanceTimersByTime(40);
    });
    const secondIndicator = requireIndicator(container);
    await act(async () => {
      dispatchOpacityTransition(secondIndicator);
    });
    expect(dismissCount).toBe(1);
  } finally {
    timers.restore();
    root.unmount();
    cleanup();
  }
});
