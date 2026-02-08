/** @file Provides Happy DOM setup helpers for unit tests. */

/** Happy DOM module type for runtime import. */
type HappyDomModule = typeof import('happy-dom');

type Cleanup = () => void;
type RpcStub = {
  off: (..._args: unknown[]) => void;
  on: (..._args: unknown[]) => void;
  removeListener: (..._args: unknown[]) => void;
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

/** Initialise Happy DOM globals for unit tests and return a cleanup function. */
export const setupHappyDom = async (): Promise<Cleanup> => {
  const releaseLease = await acquireHappyDomLease();
  let cleanupComplete = false;
  let windowToClose: {close: () => void} | null = null;
  const globalHost = globalThis as typeof globalThis & {
    window?: Window & typeof globalThis.window;
    document?: Document;
    navigator?: Navigator;
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const hadWindow = Object.hasOwn(globalHost, 'window');
  const hadDocument = Object.hasOwn(globalHost, 'document');
  const hadNavigator = Object.hasOwn(globalHost, 'navigator');
  const previousWindow = globalHost.window;
  const previousDocument = globalHost.document;
  const previousNavigator = globalHost.navigator;
  const actEnvironmentHost = globalHost;
  const hadActEnvironment = Object.hasOwn(actEnvironmentHost, 'IS_REACT_ACT_ENVIRONMENT');
  const previousActEnvironment = actEnvironmentHost.IS_REACT_ACT_ENVIRONMENT;

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
        delete globalHost.window;
      }
      if (hadDocument) {
        Object.defineProperty(globalHost, 'document', {
          configurable: true,
          value: previousDocument
        });
      } else {
        delete globalHost.document;
      }
      if (hadNavigator) {
        Object.defineProperty(globalHost, 'navigator', {
          configurable: true,
          value: previousNavigator
        });
      } else {
        delete globalHost.navigator;
      }
      if (hadActEnvironment) {
        Object.defineProperty(actEnvironmentHost, 'IS_REACT_ACT_ENVIRONMENT', {
          configurable: true,
          value: previousActEnvironment
        });
      } else {
        delete actEnvironmentHost.IS_REACT_ACT_ENVIRONMENT;
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
    windowToClose = window as unknown as {close: () => void};

    Object.defineProperty(globalHost, 'window', {
      configurable: true,
      value: window as unknown as Window & typeof globalThis.window
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

    if (!window.requestAnimationFrame) {
      window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        return window.setTimeout(() => callback(window.performance.now()), 0);
      }) as unknown as typeof window.requestAnimationFrame;
    }

    if (!window.cancelAnimationFrame) {
      window.cancelAnimationFrame = ((handle: ReturnType<typeof window.setTimeout>) => {
        window.clearTimeout(handle);
      }) as unknown as typeof window.cancelAnimationFrame;
    }

    (window as unknown as {rpc: RpcStub}).rpc = {
      off: (..._args: unknown[]) => {},
      on: (..._args: unknown[]) => {},
      removeListener: (..._args: unknown[]) => {}
    };

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
