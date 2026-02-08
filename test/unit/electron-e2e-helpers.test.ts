/** @file Tests deterministic branches in shared Electron E2E helper utilities. */
import fs from 'node:fs/promises';
import path from 'node:path';

import {expect, test} from 'bun:test';

import {
  createIsolatedE2EEnvironment,
  extractRendererErrorMessage,
  isNonCriticalRendererError,
  readActiveTerminalBuffer,
  resolveLaunchConfig,
  startRendererConsoleMonitor,
  waitForRendererReady,
  withTimeout
} from '../e2e/electron-e2e-helpers';

const baseDir = '/tmp/velocetty/test/e2e';

test('withTimeout() resolves completed work before the deadline', async () => {
  await expect(withTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok');
});

test('withTimeout() rejects when work exceeds the timeout budget', async () => {
  const pendingPromise = new Promise<void>(() => {});
  await expect(withTimeout(pendingPromise, 1)).rejects.toThrow('Timed out after 1ms');
});

test('withTimeout() forwards promise rejections before timeout elapses', async () => {
  const failure = new Error('boom');
  await expect(withTimeout(Promise.reject(failure), 50)).rejects.toThrow('boom');
});

test('resolveLaunchConfig() returns Linux defaults without sandbox flags', () => {
  expect(
    resolveLaunchConfig({
      platform: 'linux',
      ci: 'false',
      electronDisableSandbox: '0',
      baseDir
    })
  ).toEqual({
    pathToBinary: path.join(baseDir, '../../dist/linux-unpacked/hyper'),
    launchArgs: []
  });
});

test.each([
  {ci: 'true'},
  {ci: 'false', electronDisableSandbox: '1'}
] as const)('resolveLaunchConfig() adds Linux sandbox flags in trigger mode %#', (overrides) => {
  expect(
    resolveLaunchConfig({
      platform: 'linux',
      baseDir,
      ...overrides
    }).launchArgs
  ).toEqual(['--no-sandbox', '--disable-setuid-sandbox']);
});

test.each([
  ['darwin', '../../dist/mac/Hyper.app/Contents/MacOS/Hyper'],
  ['win32', '../../dist/win-unpacked/Hyper.exe']
] as const)('resolveLaunchConfig() returns packaged paths for %s', (platform, relativeBinaryPath) => {
  expect(
    resolveLaunchConfig({
      platform,
      baseDir
    }).pathToBinary
  ).toBe(path.join(baseDir, relativeBinaryPath));
});

test('resolveLaunchConfig() rejects unsupported platforms', () => {
  expect(() =>
    resolveLaunchConfig({
      platform: 'freebsd' as NodeJS.Platform,
      baseDir
    })
  ).toThrow('Path to the built binary needs to be defined for this platform');
});

test('waitForRendererReady() waits for mount and terminal selectors', async () => {
  const capturedSelectors: string[][] = [];
  let checkCount = 0;
  const mockPage = {
    evaluate: (_pageFunction: unknown, selectors: string[]) => {
      capturedSelectors.push(selectors);
      checkCount += 1;
      return Promise.resolve(checkCount > 1);
    }
  };

  await expect(waitForRendererReady(mockPage as never, 500)).resolves.toBeUndefined();
  expect(capturedSelectors).toEqual([
    ['.xterm', '.term_term', '.tabs_list'],
    ['.xterm', '.term_term', '.tabs_list']
  ]);
});

test('startRendererConsoleMonitor() captures only critical renderer errors', () => {
  type ConsoleListener = (message: {type: () => string; text: () => string}) => void;
  const listeners: ConsoleListener[] = [];
  const mockPage = {
    on: (_event: string, listener: ConsoleListener) => {
      listeners.push(listener);
    },
    off: (_event: string, listener: ConsoleListener) => {
      const listenerIndex = listeners.indexOf(listener);
      if (listenerIndex >= 0) {
        listeners.splice(listenerIndex, 1);
      }
    }
  };

  const monitor = startRendererConsoleMonitor(mockPage as never);
  const listener = listeners.at(0);
  if (!listener) {
    throw new Error('Expected startRendererConsoleMonitor() to register a listener');
  }

  listener({
    type: () => 'error',
    text: () => 'DevTools failed to load source map'
  });
  listener({
    type: () => 'warning',
    text: () => 'warning message'
  });
  listener({
    type: () => 'error',
    text: () => 'Unhandled renderer crash'
  });

  expect(monitor.criticalErrors).toEqual(['Unhandled renderer crash']);
  monitor.stop();
  expect(listeners).toHaveLength(0);
});

test('isNonCriticalRendererError() matches known allowlisted errors', () => {
  expect(isNonCriticalRendererError('DevTools failed to load source map')).toBe(true);
  expect(isNonCriticalRendererError('Unhandled renderer crash')).toBe(false);
});

test('extractRendererErrorMessage() strips e2e prefix and source metadata', () => {
  expect(extractRendererErrorMessage('[e2e][renderer-error] /path/to/file.js:42 Unhandled renderer crash')).toBe(
    'Unhandled renderer crash'
  );
  expect(extractRendererErrorMessage('Plain renderer error')).toBe('Plain renderer error');
});

test('readActiveTerminalBuffer() passes default line limit to page evaluation', async () => {
  let capturedLineLimit = 0;
  const mockPage = {
    evaluate: (_pageFunction: unknown, lineLimit: number) => {
      capturedLineLimit = lineLimit;
      return Promise.resolve(['line one']);
    }
  };

  await expect(readActiveTerminalBuffer(mockPage as never)).resolves.toEqual(['line one']);
  expect(capturedLineLimit).toBe(40);
});

test('readActiveTerminalBuffer() surfaces clear failures when renderer document is unavailable', async () => {
  const mockPage = {
    evaluate: (pageFunction: (lineLimit: number) => string[], lineLimit: number) =>
      Promise.resolve().then(() => pageFunction(lineLimit))
  };

  await expect(readActiveTerminalBuffer(mockPage as never)).rejects.toThrow(
    '[e2e] unable to read active terminal buffer: renderer document is unavailable'
  );
});

test('createIsolatedE2EEnvironment() creates and cleans temp home paths', async () => {
  const isolated = await createIsolatedE2EEnvironment();
  expect(isolated.env.HOME).toBeDefined();
  expect(isolated.env.XDG_CONFIG_HOME).toBe(isolated.env.HOME);
  expect(isolated.env.USERPROFILE).toBe(isolated.env.HOME);
  expect(isolated.env.APPDATA).toBeDefined();
  expect(isolated.env.LOCALAPPDATA).toBeDefined();

  await fs.access(isolated.env.HOME!);
  await fs.access(isolated.env.APPDATA!);
  await fs.access(isolated.env.LOCALAPPDATA!);
  await isolated.cleanup();
  await expect(fs.access(isolated.env.HOME!)).rejects.toThrow();
});
