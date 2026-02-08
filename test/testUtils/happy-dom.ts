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
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousNavigator = globalThis.navigator;
  const actEnvironmentHost = globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean};
  const hadActEnvironment = Object.hasOwn(actEnvironmentHost, 'IS_REACT_ACT_ENVIRONMENT');
  const previousActEnvironment = actEnvironmentHost.IS_REACT_ACT_ENVIRONMENT;

  try {
    const {Window} = await loadHappyDom();
    const window = new Window();

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: window as unknown as Window & typeof globalThis.window
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: window.document
    });
    Object.defineProperty(globalThis, 'navigator', {
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
      window.cancelAnimationFrame = ((handle: number | NodeJS.Timeout) => {
        window.clearTimeout(handle as NodeJS.Timeout);
      }) as unknown as typeof window.cancelAnimationFrame;
    }

    (window as unknown as {rpc: RpcStub}).rpc = {
      off: (..._args: unknown[]) => {},
      on: (..._args: unknown[]) => {},
      removeListener: (..._args: unknown[]) => {}
    };

    return () => {
      if (cleanupComplete) {
        return;
      }
      cleanupComplete = true;

      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow
      });
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: previousDocument
      });
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: previousNavigator
      });
      if (hadActEnvironment) {
        Object.defineProperty(actEnvironmentHost, 'IS_REACT_ACT_ENVIRONMENT', {
          configurable: true,
          value: previousActEnvironment
        });
      } else {
        delete actEnvironmentHost.IS_REACT_ACT_ENVIRONMENT;
      }
      window.close();
      releaseLease();
    };
  } catch (error) {
    if (!cleanupComplete) {
      cleanupComplete = true;
      releaseLease();
    }
    throw error;
  }
};
