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

test('resolveLaunchConfig() returns packaged paths for darwin and win32', () => {
  expect(
    resolveLaunchConfig({
      platform: 'darwin',
      baseDir
    }).pathToBinary
  ).toBe(path.join(baseDir, '../../dist/mac/Hyper.app/Contents/MacOS/Hyper'));

  expect(
    resolveLaunchConfig({
      platform: 'win32',
      baseDir
    }).pathToBinary
  ).toBe(path.join(baseDir, '../../dist/win-unpacked/Hyper.exe'));
});

test('resolveLaunchConfig() rejects unsupported platforms', () => {
  expect(() =>
    resolveLaunchConfig({
      platform: 'freebsd' as NodeJS.Platform,
      baseDir
    })
  ).toThrow('Path to the built binary needs to be defined for this platform');
});
