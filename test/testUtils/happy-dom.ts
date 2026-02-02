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

/** Lazily load Happy DOM via dynamic import to keep tests light. */
const loadHappyDom = (): Promise<HappyDomModule> => {
  if (!happyDomModule) {
    happyDomModule = import('happy-dom');
  }
  return happyDomModule;
};

/** Initialise Happy DOM globals for unit tests and return a cleanup function. */
export const setupHappyDom = async (): Promise<Cleanup> => {
  const {Window} = await loadHappyDom();
  const window = new Window();
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousNavigator = globalThis.navigator;

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
    window.close();
  };
};
