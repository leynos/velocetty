/** @file Verifies environment-based GPU startup configuration. */
import {expect, test} from 'bun:test';

import {configureGpuMode, shouldDisableGpu, shouldSuppressChromiumErrorLogs} from '../../app/utils/configure-gpu';

type SwitchCall = {
  switchName: string;
  value?: string;
};

const createAppStub = () => {
  const switchCalls: SwitchCall[] = [];
  let hardwareAccelerationDisabledCount = 0;

  return {
    app: {
      disableHardwareAcceleration: () => {
        hardwareAccelerationDisabledCount += 1;
      },
      commandLine: {
        appendSwitch: (switchName: string, value?: string) => {
          switchCalls.push({switchName, value});
        }
      }
    },
    getSwitchCalls: () => switchCalls,
    getHardwareAccelerationDisabledCount: () => hardwareAccelerationDisabledCount
  };
};

test('shouldDisableGpu returns true only when VELOCETTY_DISABLE_GPU is 1', () => {
  expect(shouldDisableGpu({VELOCETTY_DISABLE_GPU: '1'})).toBe(true);
  expect(shouldDisableGpu({VELOCETTY_DISABLE_GPU: '0'})).toBe(false);
  expect(shouldDisableGpu({VELOCETTY_DISABLE_GPU: 'true'})).toBe(false);
  expect(shouldDisableGpu({})).toBe(false);
});

test('shouldSuppressChromiumErrorLogs defaults to true unless explicitly disabled', () => {
  expect(shouldSuppressChromiumErrorLogs({})).toBe(true);
  expect(shouldSuppressChromiumErrorLogs({VELOCETTY_SUPPRESS_CHROMIUM_ERROR_LOGS: '1'})).toBe(true);
  expect(shouldSuppressChromiumErrorLogs({VELOCETTY_SUPPRESS_CHROMIUM_ERROR_LOGS: '0'})).toBe(false);
});

test('configureGpuMode keeps GPU enabled by default', () => {
  const stub = createAppStub();

  configureGpuMode(stub.app, {});

  expect(stub.getHardwareAccelerationDisabledCount()).toBe(0);
  expect(stub.getSwitchCalls()).toEqual([{switchName: 'log-level', value: '3'}, {switchName: 'ignore-gpu-blacklist'}]);
});

test('configureGpuMode disables GPU when VELOCETTY_DISABLE_GPU is set', () => {
  const stub = createAppStub();

  configureGpuMode(stub.app, {VELOCETTY_DISABLE_GPU: '1'});

  expect(stub.getHardwareAccelerationDisabledCount()).toBe(1);
  expect(stub.getSwitchCalls()).toEqual([
    {switchName: 'log-level', value: '3'},
    {switchName: 'disable-gpu'},
    {switchName: 'disable-gpu-compositing'},
    {switchName: 'disable-features', value: 'VaapiVideoDecoder'}
  ]);
});

test('configureGpuMode keeps Chromium error logs when suppression is disabled', () => {
  const stub = createAppStub();

  configureGpuMode(stub.app, {VELOCETTY_SUPPRESS_CHROMIUM_ERROR_LOGS: '0'});

  expect(stub.getSwitchCalls()).toEqual([{switchName: 'ignore-gpu-blacklist'}]);
});

test('configureGpuMode disables GPU without log-level override when suppression is disabled', () => {
  const stub = createAppStub();

  configureGpuMode(stub.app, {
    VELOCETTY_DISABLE_GPU: '1',
    VELOCETTY_SUPPRESS_CHROMIUM_ERROR_LOGS: '0'
  });

  expect(stub.getHardwareAccelerationDisabledCount()).toBe(1);
  expect(stub.getSwitchCalls()).toEqual([
    {switchName: 'disable-gpu'},
    {switchName: 'disable-gpu-compositing'},
    {switchName: 'disable-features', value: 'VaapiVideoDecoder'}
  ]);
});

test('configureGpuMode allows overriding Chromium log level', () => {
  const stub = createAppStub();

  configureGpuMode(stub.app, {VELOCETTY_CHROMIUM_LOG_LEVEL: '2'});

  expect(stub.getSwitchCalls()).toEqual([{switchName: 'log-level', value: '2'}, {switchName: 'ignore-gpu-blacklist'}]);
});
