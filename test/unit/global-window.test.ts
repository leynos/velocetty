/** @file Locks in `installTestWindow` restore semantics for shared unit suites. */
import {afterEach, beforeEach, expect, test} from 'bun:test';

import {installTestWindow} from '../testUtils/global-window';

type WindowHost = typeof globalThis & {
  window?: unknown;
};

const windowHost = globalThis as WindowHost;

let originalWindowDescriptor: PropertyDescriptor | undefined;

const restoreOriginalWindowDescriptor = () => {
  if (originalWindowDescriptor) {
    Object.defineProperty(windowHost, 'window', originalWindowDescriptor);
    return;
  }

  delete windowHost.window;
};

beforeEach(() => {
  originalWindowDescriptor = Object.getOwnPropertyDescriptor(windowHost, 'window');
});

afterEach(() => {
  restoreOriginalWindowDescriptor();
});

test('installTestWindow removes window again when it was initially absent', () => {
  delete windowHost.window;

  const restoreWindow = installTestWindow({testWindow: true});

  expect(Object.hasOwn(windowHost, 'window')).toBe(true);
  expect(windowHost.window).toEqual({testWindow: true});

  restoreWindow();

  expect(Object.hasOwn(windowHost, 'window')).toBe(false);
  expect(windowHost.window).toBeUndefined();
});

test('installTestWindow restores the prior window value when one existed', () => {
  const originalWindow = {originalWindow: true};
  Object.defineProperty(windowHost, 'window', {
    configurable: true,
    value: originalWindow
  });
  const expectedWindowDescriptor = Object.getOwnPropertyDescriptor(windowHost, 'window');

  const replacementWindow = {replacementWindow: true};
  const restoreWindow = installTestWindow(replacementWindow);

  expect(windowHost.window).toBe(replacementWindow);

  restoreWindow();

  expect(windowHost.window).toBe(originalWindow);
  expect(Object.getOwnPropertyDescriptor(windowHost, 'window')).toStrictEqual(expectedWindowDescriptor);
});

test('installTestWindow keeps the descriptor configurable for later overwrites', () => {
  const expectedWindowDescriptor = Object.getOwnPropertyDescriptor(windowHost, 'window');
  const restoreWindow = installTestWindow({firstWindow: true});
  const laterWindow = {laterWindow: true};

  Object.defineProperty(windowHost, 'window', {
    configurable: true,
    value: laterWindow
  });

  expect(windowHost.window).toBe(laterWindow);

  restoreWindow();

  expect(Object.getOwnPropertyDescriptor(windowHost, 'window')).toStrictEqual(expectedWindowDescriptor);
});
