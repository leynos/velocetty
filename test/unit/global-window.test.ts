/** @file Locks in `installTestWindow` restore semantics for shared unit suites. */
import {afterEach, beforeEach, expect, test} from 'bun:test';

import {installTestWindow} from '../testUtils/global-window';

type WindowTestHost = {window?: unknown};
const windowTestHost: WindowTestHost = globalThis;

let originalWindowDescriptor: PropertyDescriptor | undefined;

const restoreOriginalWindowDescriptor = () => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    return;
  }

  Reflect.deleteProperty(globalThis, 'window');
};

beforeEach(() => {
  originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
});

afterEach(() => {
  restoreOriginalWindowDescriptor();
});

test('installTestWindow removes window again when it was initially absent', () => {
  Reflect.deleteProperty(globalThis, 'window');

  const restoreWindow = installTestWindow({testWindow: true});

  expect(Object.hasOwn(globalThis, 'window')).toBe(true);
  expect(windowTestHost.window).toEqual({testWindow: true});

  restoreWindow();

  expect(Object.hasOwn(globalThis, 'window')).toBe(false);
  expect(windowTestHost.window).toBeUndefined();
});

test('installTestWindow restores the prior window value when one existed', () => {
  const originalWindow = {originalWindow: true};
  const currentWindow = originalWindow;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    enumerable: false,
    get: () => currentWindow
  });
  const expectedWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

  const replacementWindow = {replacementWindow: true};
  const restoreWindow = installTestWindow(replacementWindow);

  expect(windowTestHost.window).toBe(replacementWindow);

  restoreWindow();

  expect(windowTestHost.window).toBe(originalWindow);
  expect(Object.getOwnPropertyDescriptor(globalThis, 'window')).toStrictEqual(expectedWindowDescriptor);
});

test('installTestWindow keeps the descriptor configurable for later overwrites', () => {
  const restoreWindow = installTestWindow({firstWindow: true});
  const laterWindow = {laterWindow: true};

  restoreWindow();

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: laterWindow
  });
  const expectedWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

  expect(windowTestHost.window).toBe(laterWindow);
  expect(Object.getOwnPropertyDescriptor(globalThis, 'window')).toStrictEqual(expectedWindowDescriptor);
});
