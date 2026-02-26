/** @file Shared helpers for Electron E2E launch and timeout behaviour. */
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {ConsoleMessage, Page} from 'playwright';

type ResolveLaunchConfigOptions = Readonly<{
  platform?: NodeJS.Platform;
  ci?: string;
  electronDisableSandbox?: string;
  baseDir?: string;
}>;

type IsolatedE2EEnvironment = Readonly<{
  env: NodeJS.ProcessEnv;
  cleanup: () => Promise<void>;
}>;

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

  const code = (error as {code?: unknown})?.code;
  return typeof code === 'string' && windowsRetriableCleanupErrorCodes.has(code);
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
  if (markerIndex < 0) {
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

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: tempHome,
    XDG_CONFIG_HOME: tempHome,
    USERPROFILE: tempHome,
    APPDATA: appData,
    LOCALAPPDATA: localAppData
  };
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
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let didTimeout = false;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      didTimeout = true;
      reject(new Error(`Timed out after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (didTimeout) {
      void promise.catch(() => {});
    }
  }
};

/**
 * Reads recent lines from the active terminal buffer in the renderer window.
 * Throws clear errors when the expected renderer wiring is unavailable.
 */
export const readActiveTerminalBuffer = async (windowPage: Page, options: ReadActiveTerminalBufferOptions = {}) => {
  const lineLimit = options.lineLimit ?? 40;
  return await windowPage.evaluate((resolvedLineLimit) => {
    const fail = (message: string): never => {
      throw new Error(`[e2e] unable to read active terminal buffer: ${message}`);
    };

    if (typeof document === 'undefined') {
      fail('renderer document is unavailable');
    }

    const termWrapper = document.querySelector('.term_wrapper');
    if (!termWrapper) {
      fail('missing `.term_wrapper` element in renderer DOM');
    }

    const fiberKey = Object.getOwnPropertyNames(termWrapper).find((key) => key.startsWith('__reactFiber$'));
    if (!fiberKey) {
      fail('React fiber metadata not found on `.term_wrapper`');
    }

    const initialNode = (termWrapper as Record<string, unknown>)[fiberKey];
    if (!initialNode || typeof initialNode !== 'object') {
      fail('React fiber metadata on `.term_wrapper` is not traversable');
    }

    type MaybeFiberNode = {stateNode?: unknown; return?: unknown};
    type MaybeTermState = {
      term?: {buffer?: {active?: {_buffer?: {lines?: {length?: number; get?: (index: number) => unknown}}}}};
    };

    let node: unknown = initialNode;
    let termStateNode: MaybeTermState | null = null;
    for (let i = 0; i < 80 && node; i += 1) {
      if (typeof node !== 'object') {
        break;
      }
      const currentNode = node as MaybeFiberNode;
      if (
        currentNode.stateNode &&
        typeof currentNode.stateNode === 'object' &&
        'term' in currentNode.stateNode &&
        (currentNode.stateNode as {term?: unknown}).term
      ) {
        termStateNode = currentNode.stateNode as MaybeTermState;
        break;
      }
      node = currentNode.return;
    }

    if (!termStateNode) {
      fail('terminal React state node was not found in fiber chain');
    }

    const lines = termStateNode.term?.buffer?.active?._buffer?.lines;
    if (!lines) {
      fail('terminal buffer lines collection is unavailable');
    }
    if (typeof lines.length !== 'number') {
      fail('terminal buffer lines collection has non-numeric length');
    }
    if (typeof lines.get !== 'function') {
      fail('terminal buffer lines collection is missing get(index)');
    }

    const output: string[] = [];
    const boundedLineLimit = Math.max(1, resolvedLineLimit);
    const start = Math.max(0, lines.length - boundedLineLimit);
    for (let index = start; index < lines.length; index += 1) {
      const line = lines.get(index) as {translateToString?: (trimRight?: boolean) => string} | undefined;
      output.push(line?.translateToString?.(true) ?? '');
    }
    return output;
  }, lineLimit);
};

/**
 * Waits until the renderer has mounted and at least one terminal-related
 * element is present in the document.
 */
export const waitForRendererReady = async (page: Page, timeoutMs: number) => {
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
  page: Page,
  nonCriticalErrorPatterns = defaultNonCriticalRendererErrorPatterns
): RendererConsoleMonitor => {
  const criticalErrors: string[] = [];
  const onConsole = (message: ConsoleMessage) => {
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
  // Bun provides __dirname in .ts modules used by this test helper.
  const baseDir = options.baseDir ?? __dirname;

  let pathToBinary: string;

  switch (platform) {
    case 'linux':
      pathToBinary = path.join(baseDir, '../../dist/linux-unpacked/hyper');
      break;
    case 'darwin':
      pathToBinary = path.join(baseDir, '../../dist/mac/Hyper.app/Contents/MacOS/Hyper');
      break;
    case 'win32':
      pathToBinary = path.join(baseDir, '../../dist/win-unpacked/Hyper.exe');
      break;
    default:
      return assertNever(platform);
  }

  const launchArgs: readonly string[] =
    platform === 'linux' && (ci === 'true' || electronDisableSandbox === '1')
      ? ['--no-sandbox', '--disable-setuid-sandbox']
      : [];

  return {pathToBinary, launchArgs};
};
