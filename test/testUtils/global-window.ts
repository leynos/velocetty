/** @file Helpers for safely replacing and restoring the global `window` in tests. */

/**
 * Replaces `globalThis.window` with a configurable test double and returns a
 * restore callback that reinstates the prior presence state.
 */
export const installTestWindow = (value: unknown = {}): (() => void) => {
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    enumerable: previousDescriptor?.enumerable ?? true,
    value
  });

  return () => {
    if (!previousDescriptor) {
      Reflect.deleteProperty(globalThis, 'window');
      return;
    }

    Object.defineProperty(globalThis, 'window', previousDescriptor);
  };
};
