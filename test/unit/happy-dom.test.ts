/** @file Verifies Happy DOM setup isolation for parallel Bun test workers. */
import {expect, test} from 'bun:test';

import {setupHappyDom} from '../testUtils/happy-dom';

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
