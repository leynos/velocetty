/** @file Shared helpers for Electron E2E launch and timeout behaviour. */
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {ConsoleMessage} from 'playwright';
import {isObject, isString} from '@shared/types/guards';

type ResolveLaunchConfigOptions = Readonly<{
  platform?: NodeJS.Platform;
  ci?: string;
  electronDisableSandbox?: string;
  baseDir?: string;
}>;

type IsolatedE2EEnvironment = Readonly<{
  /**
   * Launch environment handed straight to Playwright.
   *
   * A plain string map rather than `NodeJS.ProcessEnv`: Playwright rejects
   * variables whose value is `undefined`, and `process.env` may contain them.
   */
  env: Record<string, string>;
  cleanup: () => Promise<void>;
}>;

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

type RemoveDirectoryWithRetryOptions = Readonly<{
  maxAttempts?: number;
  baseDelayMs?: number;
  isWindows?: boolean;
  removeDirectory?: (directory: string) => Promise<void>;
  sleepFn?: (ms: number) => Promise<void>;
}>;

type ReadActiveTerminalBufferOptions = Readonly<{
  lineLimit?: number;
}>;

type SupportedPlatform = 'linux' | 'darwin' | 'win32';
type ActiveTerminalBufferPage = {
  evaluate: (callback: (lineLimit: number) => string[], lineLimit: number) => Promise<string[]>;
};
type RendererReadyPage = {
  evaluate: (callback: (selectors: string[]) => boolean, selectors: string[]) => Promise<boolean>;
};
type RendererConsolePage = {
  on: (event: 'console', listener: (message: Pick<ConsoleMessage, 'type' | 'text'>) => void) => void;
  off: (event: 'console', listener: (message: Pick<ConsoleMessage, 'type' | 'text'>) => void) => void;
};

export const nowMs = (): number => performance.now();

const isSupportedPlatform = (platform: NodeJS.Platform): platform is SupportedPlatform =>
  platform === 'linux' || platform === 'darwin' || platform === 'win32';

const assertNever = (value: never): never => {
  throw new Error(`Unsupported platform: ${String(value)}`);
};

const defaultNonCriticalRendererErrorPatterns = [/Download the React DevTools/i, /DevTools failed to load source map/i];
const windowsRetriableCleanupErrorCodes = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY']);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const removeDirectoryRecursive = async (directory: string) => {
  await fs.rm(directory, {recursive: true, force: true});
};

const isRetriableCleanupError = (error: unknown, isWindows: boolean) => {
  if (!isWindows) {
    return false;
  }

  if (!isObject(error) || !('code' in error)) {
    return false;
  }
  const code = error.code;
  return isString(code) && windowsRetriableCleanupErrorCodes.has(code);
};

export const removeDirectoryWithRetry = async (directory: string, options: RemoveDirectoryWithRetryOptions = {}) => {
  const maxAttempts = options.maxAttempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 100;
  const isWindows = options.isWindows ?? process.platform === 'win32';
  const removeDirectory = options.removeDirectory ?? removeDirectoryRecursive;
  const sleepFn = options.sleepFn ?? sleep;

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError('removeDirectoryWithRetry maxAttempts must be an integer greater than 0.');
  }

  if (!Number.isFinite(baseDelayMs) || baseDelayMs <= 0) {
    throw new RangeError('removeDirectoryWithRetry baseDelayMs must be a finite number greater than 0.');
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await removeDirectory(directory);
      return;
    } catch (error) {
      if (attempt >= maxAttempts || !isRetriableCleanupError(error, isWindows)) {
        throw error;
      }

      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      await sleepFn(delayMs);
    }
  }
};

export const isNonCriticalRendererError = (
  text: string,
  nonCriticalErrorPatterns = defaultNonCriticalRendererErrorPatterns
) => nonCriticalErrorPatterns.some((pattern) => pattern.test(text));

/**
 * Extracts the underlying renderer error message from an
 * `[e2e][renderer-error]` log line.
 */
export const extractRendererErrorMessage = (line: string) => {
  const marker = '[e2e][renderer-error]';
  const markerIndex = line.indexOf(marker);
  if (markerIndex === -1) {
    return line.trim();
  }

  const payload = line.slice(markerIndex + marker.length).trim();
  return payload.replace(/^\S+:\d+\s+/, '');
};

/**
 * Creates an isolated HOME/XDG/Windows AppData environment to avoid loading
 * user plugins or local developer configuration during E2E runs.
 */
export const createIsolatedE2EEnvironment = async (): Promise<IsolatedE2EEnvironment> => {
  const tempHome = await fs.mkdtemp(path.join(tmpdir(), 'velocetty-e2e-home-'));
  const appData = path.join(tempHome, 'AppData', 'Roaming');
  const localAppData = path.join(tempHome, 'AppData', 'Local');
  await fs.mkdir(appData, {recursive: true});
  await fs.mkdir(localAppData, {recursive: true});

  const parentEnvironment: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
  // `satisfies` rather than an annotation: the literal already has the exact
  // map type Playwright wants, and stating it keeps the overridden keys visible
  // as the string values the environment contract requires.
  const env = {
    ...parentEnvironment,
    HOME: tempHome,
    XDG_CONFIG_HOME: tempHome,
    USERPROFILE: tempHome,
    APPDATA: appData,
    LOCALAPPDATA: localAppData
  } satisfies Record<string, string>;
  return {
    env,
    cleanup: async () => {
      await removeDirectoryWithRetry(tempHome);
    }
  };
};

/**
 * Returns a promise that rejects when the timeout elapses.
 */
export const withTimeout = async <T>(promise: Promise<T>, ms: number) => {
  const timeoutState = {didTimeout: false};
  const timeout = Promise.withResolvers<never>();
  const timeoutId = setTimeout(() => {
    timeoutState.didTimeout = true;
    timeout.reject(new Error(`Timed out after ${ms}ms`));
  }, ms);
  try {
    return await Promise.race([promise, timeout.promise]);
  } finally {
    clearTimeout(timeoutId);
    if (timeoutState.didTimeout) {
      void promise.catch(() => {});
    }
  }
};

/** One line of xterm's scrollback, as much of it as this helper reads. */
type TerminalBufferLine = {translateToString?: (trimRight?: boolean) => string};

/** The scrollback collection a terminal buffer exposes. */
type TerminalBufferLines = {length: number; get: (index: number) => TerminalBufferLine | undefined};

/** The React fiber fields the chain walk follows. */
type FiberNode = {stateNode?: unknown; return?: unknown};

/** The xterm state hung off a fiber's `stateNode`. */
type FiberTermState = {term?: {buffer?: {active?: {_buffer?: {lines?: unknown}}}}};

/**
 * Reads the active terminal buffer inside the renderer.
 *
 * Defined at module scope, and kept self-contained, because Playwright
 * serialises the callback as source text: it may reference only its argument
 * and the browser globals, so every helper it needs is declared inside it.
 */
const readActiveTerminalBufferInPage = (resolvedLineLimit: number): string[] => {
  const failurePrefix = '[e2e] unable to read active terminal buffer';
  const fail: (message: string) => never = (message) => {
    throw new Error(`${failurePrefix}: ${message}`);
  };
  const requirePresent = <T>(value: T | null | undefined, message: string): T => value ?? fail(message);

  if (typeof document === 'undefined') {
    fail('renderer document is unavailable');
  }
  const termWrapper = requirePresent(
    document.querySelector('.term_wrapper'),
    'missing `.term_wrapper` element in renderer DOM'
  );
  const fiberKey = requirePresent(
    Object.getOwnPropertyNames(termWrapper).find((key) => key.startsWith('__reactFiber$')),
    'React fiber metadata not found on `.term_wrapper`'
  );

  const isRendererObject = (value: unknown): value is object =>
    value !== termWrapper && typeof value === 'object' && value !== null;
  const isFiberNode = (value: unknown): value is FiberNode =>
    isRendererObject(value) && ('stateNode' in value || 'return' in value);
  const isBufferLines = (value: unknown): value is TerminalBufferLines =>
    isRendererObject(value) && 'length' in value && 'get' in value;

  /**
   * Reads the scrollback collection a single fiber carries, if it has one.
   *
   * xterm nests the buffer behind optional fields that only exist once the
   * terminal has mounted, so each hop is read defensively.
   */
  const readFiberLines = (fiber: FiberNode): TerminalBufferLines | null => {
    // SAFETY: `stateNode` is opaque to the renderer's typings. The traversal
    // only follows nodes carrying fiber fields, and the result is checked by
    // `isBufferLines` before anything is read from it.
    const candidate = (fiber.stateNode as FiberTermState | undefined)?.term?.buffer?.active?._buffer?.lines;
    return isBufferLines(candidate) ? candidate : null;
  };

  /** Walks the fiber chain upward to the xterm scrollback collection. */
  const findBufferLines = (wrapper: Element): TerminalBufferLines => {
    const initialNode = Object.getOwnPropertyDescriptor(wrapper, fiberKey)?.value;
    if (!isFiberNode(initialNode)) {
      fail('React fiber metadata on `.term_wrapper` is not traversable');
    }
    let node: FiberNode | undefined = initialNode;
    for (let depth = 0; depth < 80 && node; depth += 1) {
      const lines = readFiberLines(node);
      if (lines) {
        return lines;
      }
      node = isFiberNode(node.return) ? node.return : undefined;
    }
    return fail('terminal buffer lines collection is unavailable');
  };

  const lines = findBufferLines(termWrapper);
  const start = Math.max(0, lines.length - Math.max(1, resolvedLineLimit));
  const output: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    output.push(lines.get(index)?.translateToString?.(true) ?? '');
  }
  return output;
};

/**
 * Reads recent lines from the active terminal buffer in the renderer window.
 * Throws clear errors when the expected renderer wiring is unavailable.
 */
export const readActiveTerminalBuffer = async (
  windowPage: ActiveTerminalBufferPage,
  options: ReadActiveTerminalBufferOptions = {}
) => windowPage.evaluate(readActiveTerminalBufferInPage, options.lineLimit ?? 40);

/**
 * Waits until the renderer has mounted and at least one terminal-related
 * element is present in the document.
 */
export const waitForRendererReady = async (page: RendererReadyPage, timeoutMs: number) => {
  const terminalSelectors = ['.xterm', '.term_term', '.tabs_list'];
  const startTime = Date.now();
  while (Date.now() - startTime <= timeoutMs) {
    const isReady = await page.evaluate((selectors) => {
      const mountNode = document.querySelector('#mount');
      if (!mountNode || mountNode.childElementCount === 0) {
        return false;
      }
      return selectors.some((selector) => document.querySelector(selector) !== null);
    }, terminalSelectors);
    if (isReady) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for renderer readiness`);
};

type RendererConsoleMonitor = Readonly<{
  criticalErrors: string[];
  stop: () => void;
}>;

/**
 * Tracks renderer console error events and filters known low-signal messages.
 */
export const startRendererConsoleMonitor = (
  page: RendererConsolePage,
  nonCriticalErrorPatterns = defaultNonCriticalRendererErrorPatterns
): RendererConsoleMonitor => {
  const criticalErrors: string[] = [];
  // Only the type and text are read, and the page's own listener signature is
  // this same `Pick`, so a narrower parameter would be rejected as
  // contravariant.
  const onConsole = (message: Pick<ConsoleMessage, 'type' | 'text'>) => {
    if (message.type() !== 'error') {
      return;
    }
    const text = message.text();
    if (!isNonCriticalRendererError(text, nonCriticalErrorPatterns)) {
      criticalErrors.push(text);
    }
  };

  page.on('console', onConsole);
  return {
    criticalErrors,
    stop: () => {
      page.off('console', onConsole);
    }
  };
};

/**
 * Resolves the packaged Electron binary path and platform-specific arguments.
 */
export const resolveLaunchConfig = (options: ResolveLaunchConfigOptions = {}) => {
  const platform = options.platform ?? process.platform;
  if (!isSupportedPlatform(platform)) {
    throw new Error('Path to the built binary needs to be defined for this platform in E2E launch helpers.');
  }
  const ci = options.ci ?? process.env.CI;
  const electronDisableSandbox = options.electronDisableSandbox ?? process.env.ELECTRON_DISABLE_SANDBOX;
  const baseDir = options.baseDir ?? moduleDirectory;

  let pathToBinary: string;

  switch (platform) {
    case 'linux': {
      pathToBinary = path.join(baseDir, '../../dist/linux-unpacked/hyper');
      break;
    }
    case 'darwin': {
      pathToBinary = path.join(baseDir, '../../dist/mac/Hyper.app/Contents/MacOS/Hyper');
      break;
    }
    case 'win32': {
      pathToBinary = path.join(baseDir, '../../dist/win-unpacked/Hyper.exe');
      break;
    }
    default: {
      return assertNever(platform);
    }
  }

  const launchArgs: readonly string[] =
    platform === 'linux' && (ci === 'true' || electronDisableSandbox === '1')
      ? ['--no-sandbox', '--disable-setuid-sandbox']
      : [];

  return {pathToBinary, launchArgs};
};
