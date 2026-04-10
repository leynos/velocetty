/**
 * @file Verifies DOM polling helpers remain portable across Bun and Happy DOM
 * runtime combinations.
 */
import {expect, test} from 'bun:test';

import {setupHappyDom} from '../testUtils/happy-dom';
import {pollForElement} from '../testUtils/pollFor';

type PropertySnapshot = {
  descriptor?: PropertyDescriptor;
  hadOwn: boolean;
  key: PropertyKey;
  target: object;
};

const snapshotProperty = (target: object, key: PropertyKey): PropertySnapshot => ({
  descriptor: Object.getOwnPropertyDescriptor(target, key),
  hadOwn: Object.hasOwn(target, key),
  key,
  target
});

const restoreProperty = ({target, key, hadOwn, descriptor}: PropertySnapshot) => {
  if (hadOwn && descriptor) {
    Object.defineProperty(target, key, descriptor);
    return;
  }

  delete (target as Record<PropertyKey, unknown>)[key];
};

test('pollForElement uses the container window MutationObserver when globalThis lacks one', async () => {
  const cleanup = await setupHappyDom();
  const container = document.createElement('div');
  const globalMutationObserver = snapshotProperty(globalThis, 'MutationObserver');

  try {
    document.body.appendChild(container);
    delete (globalThis as typeof globalThis & {MutationObserver?: typeof MutationObserver}).MutationObserver;

    const waiter = pollForElement(container, 'span', 250);
    window.setTimeout(() => {
      container.appendChild(document.createElement('span'));
    }, 0);

    const element = await waiter;
    expect(element.tagName).toBe('SPAN');
  } finally {
    restoreProperty(globalMutationObserver);
    container.remove();
    cleanup();
  }
});

test('pollForElement falls back to active polling when no MutationObserver is available', async () => {
  const cleanup = await setupHappyDom();
  const container = document.createElement('div');
  const globalMutationObserver = snapshotProperty(globalThis, 'MutationObserver');
  const windowMutationObserver = snapshotProperty(window, 'MutationObserver');

  try {
    document.body.appendChild(container);
    delete (globalThis as typeof globalThis & {MutationObserver?: typeof MutationObserver}).MutationObserver;
    Object.defineProperty(window, 'MutationObserver', {
      configurable: true,
      value: undefined
    });

    const waiter = pollForElement(container, 'button[title="delayed"]', 250);
    window.setTimeout(() => {
      const button = document.createElement('button');
      button.title = 'delayed';
      container.appendChild(button);
    }, 0);

    const element = await waiter;
    expect(element.getAttribute('title')).toBe('delayed');
  } finally {
    restoreProperty(windowMutationObserver);
    restoreProperty(globalMutationObserver);
    container.remove();
    cleanup();
  }
});
