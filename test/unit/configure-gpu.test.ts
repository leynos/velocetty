/** @file Verifies environment-based GPU startup configuration. */
import {expect, test} from 'bun:test';

import {configureGpuMode, shouldDisableGpu} from '../../app/utils/configure-gpu';

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

test('configureGpuMode keeps GPU enabled by default', () => {
  const stub = createAppStub();

  configureGpuMode(stub.app, {});

  expect(stub.getHardwareAccelerationDisabledCount()).toBe(0);
  expect(stub.getSwitchCalls()).toEqual([{switchName: 'ignore-gpu-blacklist'}]);
});

test('configureGpuMode disables GPU when VELOCETTY_DISABLE_GPU is set', () => {
  const stub = createAppStub();

  configureGpuMode(stub.app, {VELOCETTY_DISABLE_GPU: '1'});

  expect(stub.getHardwareAccelerationDisabledCount()).toBe(1);
  expect(stub.getSwitchCalls()).toEqual([
    {switchName: 'disable-gpu'},
    {switchName: 'disable-gpu-compositing'},
    {switchName: 'disable-features', value: 'VaapiVideoDecoder'}
  ]);
});
