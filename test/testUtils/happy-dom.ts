/** @file Provides Happy DOM setup helpers for unit tests. */

import {isFunction} from '@shared/types/guards';

/** Happy DOM module type for runtime import. */
type HappyDomModule = typeof import('happy-dom');
type HappyDomWindow = InstanceType<HappyDomModule['Window']>;

/**
 * Checks that a window provides both animation-frame methods.
 *
 * The pair is checked together because they only make sense as a pair: a
 * handle from one is what the other is given back.
 */
const hasAnimationFrames = (window: HappyDomWindow): boolean =>
  isFunction(window.requestAnimationFrame) && isFunction(window.cancelAnimationFrame);

type Cleanup = () => void;
type HappyDomGlobalHost = {
  window?: unknown;
  document?: unknown;
  navigator?: unknown;
  IS_REACT_ACT_ENVIRONMENT?: unknown;
};
let happyDomModule: Promise<HappyDomModule> | null = null;
/** Serializes concurrent Happy DOM setup/teardown cycles across test files. */
let happyDomLease: Promise<void> = Promise.resolve();

/**
 * Acquires exclusive access to global Happy DOM wiring.
 *
 * Tests that call `setupHappyDom()` mutate global browser-like objects
 * (`window`, `document`, `navigator`). Bun may execute test files in parallel,
 * so we serialize setup/teardown to avoid cross-file global-state races.
 */
const acquireHappyDomLease = async (): Promise<() => void> => {
  const previousLease = happyDomLease;
  let releaseLease!: () => void;
  happyDomLease = new Promise<void>((resolve) => {
    releaseLease = resolve;
  });
  await previousLease;
  return releaseLease;
};

/** Lazily load Happy DOM via dynamic import to keep tests light. */
const loadHappyDom = (): Promise<HappyDomModule> => {
  if (!happyDomModule) {
    happyDomModule = import('happy-dom');
  }
  return happyDomModule;
};

/** Initialize Happy DOM globals for unit tests and return a cleanup function. */
export const setupHappyDom = async (): Promise<Cleanup> => {
  const releaseLease = await acquireHappyDomLease();
  let cleanupComplete = false;
  let windowToClose: Pick<HappyDomWindow, 'close'> | null = null;
  const globalHost: HappyDomGlobalHost = globalThis;
  const hadWindow = Object.hasOwn(globalHost, 'window');
  const hadDocument = Object.hasOwn(globalHost, 'document');
  const hadNavigator = Object.hasOwn(globalHost, 'navigator');
  const previousWindow = globalHost.window;
  const previousDocument = globalHost.document;
  const previousNavigator = globalHost.navigator;
  const actEnvironmentHost = globalHost;
  const hadActEnvironment = Object.hasOwn(actEnvironmentHost, 'IS_REACT_ACT_ENVIRONMENT');
  const previousActEnvironment = globalHost.IS_REACT_ACT_ENVIRONMENT;

  const finalizeSetup = () => {
    if (cleanupComplete) {
      return;
    }
    cleanupComplete = true;

    let finalizeError: unknown;
    try {
      if (hadWindow) {
        Object.defineProperty(globalHost, 'window', {
          configurable: true,
          value: previousWindow
        });
      } else {
        Reflect.deleteProperty(globalHost, 'window');
      }
      if (hadDocument) {
        Object.defineProperty(globalHost, 'document', {
          configurable: true,
          value: previousDocument
        });
      } else {
        Reflect.deleteProperty(globalHost, 'document');
      }
      if (hadNavigator) {
        Object.defineProperty(globalHost, 'navigator', {
          configurable: true,
          value: previousNavigator
        });
      } else {
        Reflect.deleteProperty(globalHost, 'navigator');
      }
      if (hadActEnvironment) {
        Object.defineProperty(actEnvironmentHost, 'IS_REACT_ACT_ENVIRONMENT', {
          configurable: true,
          value: previousActEnvironment
        });
      } else {
        Reflect.deleteProperty(actEnvironmentHost, 'IS_REACT_ACT_ENVIRONMENT');
      }
    } catch (error) {
      finalizeError = error;
    }

    try {
      windowToClose?.close();
    } catch (error) {
      if (!finalizeError) {
        finalizeError = error;
      }
    } finally {
      releaseLease();
    }

    if (finalizeError) {
      throw finalizeError;
    }
  };

  try {
    const {Window} = await loadHappyDom();
    const window = new Window();
    windowToClose = window;

    Object.defineProperty(globalHost, 'window', {
      configurable: true,
      value: window
    });
    Object.defineProperty(globalHost, 'document', {
      configurable: true,
      value: window.document
    });
    Object.defineProperty(globalHost, 'navigator', {
      configurable: true,
      value: window.navigator
    });
    Object.defineProperty(actEnvironmentHost, 'IS_REACT_ACT_ENVIRONMENT', {
      configurable: true,
      value: true
    });

    // Happy DOM implements both animation-frame methods itself, scheduling
    // frames as immediates and ignoring handles it did not issue. A
    // `setTimeout`-backed substitute would therefore look right and never
    // cancel, so a window that lacks them is a broken installation rather than
    // something to paper over here.
    if (!hasAnimationFrames(window)) {
      throw new TypeError('Happy DOM did not provide requestAnimationFrame and cancelAnimationFrame.');
    }

    Object.defineProperty(window, 'rpc', {
      configurable: true,
      value: {
        off: (..._args: unknown[]) => {},
        on: (..._args: unknown[]) => {},
        removeListener: (..._args: unknown[]) => {}
      }
    });

    return () => finalizeSetup();
  } catch (error) {
    try {
      finalizeSetup();
    } catch (finalizeError) {
      throw new AggregateError([error, finalizeError], 'Failed to initialize and cleanup Happy DOM globals');
    }
    throw error;
  }
};
