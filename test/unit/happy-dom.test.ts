/** @file Verifies Happy DOM setup isolation for parallel Bun test workers. */
import {expect, test} from 'bun:test';

import {setupHappyDom} from '../testUtils/happy-dom';

/** Flushes queued microtasks so async setup ordering can be observed in tests. */
const waitForMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test.serial('setupHappyDom serializes concurrent setup calls', async () => {
  const firstCleanup = await setupHappyDom();
  const firstWindow = globalThis.window;

  let secondResolved = false;
  const secondSetup = setupHappyDom().then((cleanup) => {
    secondResolved = true;
    return cleanup;
  });

  await waitForMicrotasks();
  expect(secondResolved).toBe(false);

  firstCleanup();
  const secondCleanup = await secondSetup;
  expect(globalThis.window).not.toBe(firstWindow);

  secondCleanup();
});

test.serial('setupHappyDom cleanup is idempotent', async () => {
  const cleanup = await setupHappyDom();
  cleanup();
  cleanup();
});

test.serial('setupHappyDom restores global property presence state', async () => {
  const hadWindow = Object.hasOwn(globalThis, 'window');
  const hadDocument = Object.hasOwn(globalThis, 'document');
  const hadNavigator = Object.hasOwn(globalThis, 'navigator');

  const cleanup = await setupHappyDom();
  cleanup();

  expect(Object.hasOwn(globalThis, 'window')).toBe(hadWindow);
  expect(Object.hasOwn(globalThis, 'document')).toBe(hadDocument);
  expect(Object.hasOwn(globalThis, 'navigator')).toBe(hadNavigator);
});
