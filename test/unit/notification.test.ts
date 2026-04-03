/** @file Exercises notification timing and dismissal behaviour. */
import React, {act} from 'react';
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';

import {expect, test} from 'bun:test';

import Notification from '../../lib/components/notification';
import {setupHappyDom} from '../testUtils/happy-dom';

import type {NotificationProps, TimerSeam} from '../../typings/hyper';

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
  indicator.dispatchEvent(buildTransitionEvent(indicator, 'opacity'));
};

const buildTransitionEvent = (target: Element, propertyName: string) => {
  // Happy DOM does not fully populate TransitionEvent fields.
  const event = new Event('transitionend') as TransitionEvent;
  Object.defineProperty(event, 'propertyName', {value: propertyName});
  Object.defineProperty(event, 'target', {value: target});
  return event;
};

/**
 * Creates a fake timer seam for deterministic timer control in tests.
 *
 * @returns Helper with advanceTimersByTime and a TimerSeam implementation.
 *
 * @example
 * ```ts
 * const {advanceTimersByTime, timerSeam} = createFakeTimerSeam();
 * // render with timer={timerSeam} prop
 * advanceTimersByTime(100);
 * ```
 */
const createFakeTimerSeam = () => {
  let now = 0;
  let nextId = 1;
  const scheduled: Array<{id: number; runAt: number; callback: () => void}> = [];

  const advanceTimersByTime = (ms: number) => {
    const target = now + ms;
    while (scheduled.length > 0 && scheduled[0].runAt <= target) {
      const [nextTimer] = scheduled;
      scheduled.shift();
      now = nextTimer.runAt;
      nextTimer.callback();
      scheduled.sort((a, b) => a.runAt - b.runAt);
    }
    now = target;
  };

  const timerSeam: TimerSeam = {
    setTimeout: (callback: () => void, delay = 0) => {
      const id = nextId++;
      scheduled.push({id, runAt: now + delay, callback});
      scheduled.sort((a, b) => a.runAt - b.runAt);
      return id as unknown as NodeJS.Timeout;
    },
    clearTimeout: (handle?: NodeJS.Timeout) => {
      const id = Number(handle);
      const index = scheduled.findIndex((t) => t.id === id);
      if (index !== -1) scheduled.splice(index, 1);
    }
  };

  return {advanceTimersByTime, timerSeam};
};

const requireIndicator = (container: HTMLElement) => {
  const indicator = container.querySelector('[data-testid="notification-indicator"]');
  expect(indicator).toBeTruthy();
  if (!indicator) {
    throw new Error('Expected notification indicator to be present.');
  }
  return indicator;
};

const requireDismissButton = (container: HTMLElement) => {
  const indicator = requireIndicator(container);
  const button = indicator.querySelector('button[type="button"]');
  expect(button).toBeTruthy();
  if (!button) {
    throw new Error('Expected dismiss button to be present.');
  }
  return button;
};

test('Notification auto-dismisses after the timeout on mount', async () => {
  const cleanup = await setupHappyDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  const {advanceTimersByTime, timerSeam} = createFakeTimerSeam();

  try {
    let dismissCount = 0;
    const dismissAfterMs = 60;
    const bufferMs = 60;
    await act(async () => {
      flushSync(() => {
        root.render(
          React.createElement(
            Notification,
            buildNotificationProps(
              dismissAfterMs,
              () => {
                dismissCount += 1;
              },
              {timer: timerSeam}
            )
          )
        );
      });
    });

    await act(async () => {
      advanceTimersByTime(dismissAfterMs + bufferMs);
    });
    const indicator = requireIndicator(container);
    await act(async () => {
      dispatchOpacityTransition(indicator);
    });

    expect(dismissCount).toBe(1);
  } finally {
    await act(async () => {
      root.unmount();
    });
    cleanup();
  }
});

test('Notification resets the timer when text changes', async () => {
  const cleanup = await setupHappyDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  const {advanceTimersByTime, timerSeam} = createFakeTimerSeam();

  try {
    let dismissCount = 0;
    const dismissAfterMs = 80;
    const onDismiss = () => {
      dismissCount += 1;
    };
    await act(async () => {
      flushSync(() => {
        root.render(
          React.createElement(
            Notification,
            buildNotificationProps(dismissAfterMs, onDismiss, {text: 'First', timer: timerSeam})
          )
        );
      });
    });

    await act(async () => {
      advanceTimersByTime(40);
    });
    await act(async () => {
      flushSync(() => {
        root.render(
          React.createElement(
            Notification,
            buildNotificationProps(dismissAfterMs, onDismiss, {text: 'Second', timer: timerSeam})
          )
        );
      });
    });

    await act(async () => {
      advanceTimersByTime(50);
    });
    let indicator = requireIndicator(container);
    await act(async () => {
      dispatchOpacityTransition(indicator);
    });
    expect(dismissCount).toBe(0);

    await act(async () => {
      advanceTimersByTime(40);
    });
    indicator = requireIndicator(container);
    await act(async () => {
      dispatchOpacityTransition(indicator);
    });
    expect(dismissCount).toBe(1);
  } finally {
    await act(async () => {
      root.unmount();
    });
    cleanup();
  }
});

test('Notification handles manual dismiss transition for user-dismissable notices', async () => {
  const cleanup = await setupHappyDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  const {timerSeam} = createFakeTimerSeam();

  try {
    let dismissCount = 0;
    await act(async () => {
      flushSync(() => {
        root.render(
          React.createElement(
            Notification,
            buildNotificationProps(
              1_000,
              () => {
                dismissCount += 1;
              },
              {userDismissable: true, userDismissColor: '#fff', timer: timerSeam}
            )
          )
        );
      });
    });

    const dismissButton = requireDismissButton(container) as HTMLButtonElement;
    await act(async () => {
      dismissButton.click();
    });

    const indicator = requireIndicator(container);
    const ignoredTransition = buildTransitionEvent(indicator, 'transform');
    await act(async () => {
      indicator.dispatchEvent(ignoredTransition);
    });
    expect(dismissCount).toBe(0);

    await act(async () => {
      dispatchOpacityTransition(indicator);
    });
    expect(dismissCount).toBe(1);
  } finally {
    await act(async () => {
      root.unmount();
    });
    cleanup();
  }
});

test('Notification forwards and clears function refs on mount lifecycle', async () => {
  const cleanup = await setupHappyDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  const refValues: Array<HTMLDivElement | null> = [];
  const notificationRef = (element: HTMLDivElement | null) => {
    refValues.push(element);
  };

  const {timerSeam} = createFakeTimerSeam();

  try {
    await act(async () => {
      flushSync(() => {
        root.render(
          React.createElement(Notification, {
            ...buildNotificationProps(250, () => {}, {timer: timerSeam}),
            ref: notificationRef
          })
        );
      });
    });

    expect(refValues.some((value) => value !== null)).toBe(true);
  } finally {
    await act(async () => {
      root.unmount();
    });
    cleanup();
  }

  // The unmount in finally invokes the ref callback with null.
  expect(refValues.at(-1)).toBeNull();
});

test('Notification auto-dismisses using global timers when no timer prop is provided', async () => {
  // This test exercises the default global timer fallback path.
  const cleanup = await setupHappyDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  let dismissCount = 0;
  const dismissAfterMs = 60;

  try {
    // IMPORTANT: No timer prop provided - this exercises the fallback path
    await act(async () => {
      flushSync(() => {
        root.render(
          React.createElement(
            Notification,
            buildNotificationProps(
              dismissAfterMs,
              () => {
                dismissCount += 1;
              }
              // timer prop intentionally omitted to test fallback
            )
          )
        );
      });
    });

    // Wait for the real timer to fire
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, dismissAfterMs + 20));
    });

    const indicator = requireIndicator(container);
    await act(async () => {
      dispatchOpacityTransition(indicator);
    });

    expect(dismissCount).toBe(1);
  } finally {
    await act(async () => {
      root.unmount();
    });
    cleanup();
  }
});
