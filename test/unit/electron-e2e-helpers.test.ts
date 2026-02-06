/** @file Tests deterministic branches in shared Electron E2E helper utilities. */
import path from 'node:path';

import {expect, test} from 'bun:test';

import {resolveLaunchConfig, withTimeout} from '../e2e/electron-e2e-helpers';

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

test('resolveLaunchConfig() adds Linux sandbox flags in CI and sandbox-disabled modes', () => {
  expect(
    resolveLaunchConfig({
      platform: 'linux',
      ci: 'true',
      baseDir
    }).launchArgs
  ).toEqual(['--no-sandbox', '--disable-setuid-sandbox']);

  expect(
    resolveLaunchConfig({
      platform: 'linux',
      ci: 'false',
      electronDisableSandbox: '1',
      baseDir
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
