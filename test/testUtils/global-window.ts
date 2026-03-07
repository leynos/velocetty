/** @file Helpers for safely replacing and restoring the global `window` in tests. */

type WindowHost = typeof globalThis & {
  window?: Window & typeof globalThis.window;
};

type WindowValue = Record<string, unknown> | (Window & typeof globalThis.window);

/**
 * Replaces `globalThis.window` with a configurable test double and returns a
 * restore callback that reinstates the prior presence state.
 */
export const installTestWindow = (value: WindowValue = {}): (() => void) => {
  const windowHost = globalThis as WindowHost;
  const hadWindow = Object.hasOwn(windowHost, 'window');
  const previousWindow = windowHost.window;

  Object.defineProperty(windowHost, 'window', {
    configurable: true,
    value
  });

  return () => {
    if (!hadWindow) {
      delete windowHost.window;
      return;
    }

    Object.defineProperty(windowHost, 'window', {
      configurable: true,
      value: previousWindow
    });
  };
};
