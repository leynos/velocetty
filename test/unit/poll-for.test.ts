/**
 * @file Verifies DOM polling helpers remain portable across Bun and Happy DOM
 * runtime combinations.
 */
import {expect, test} from 'bun:test';

import {setupHappyDom} from '../testUtils/happy-dom';
import {pollForElement} from '../testUtils/poll-for';

type PropertySnapshot = {
  descriptor?: PropertyDescriptor;
  hadOwn: boolean;
  target: PropertySnapshotTarget;
};

type PropertySnapshotTarget = typeof globalThis | Window;

const snapshotProperty = (target: PropertySnapshotTarget): PropertySnapshot => ({
  descriptor: Object.getOwnPropertyDescriptor(target, 'MutationObserver'),
  hadOwn: Object.hasOwn(target, 'MutationObserver'),
  target
});

const restoreProperty = ({target, hadOwn, descriptor}: PropertySnapshot) => {
  if (hadOwn && descriptor) {
    Object.defineProperty(target, 'MutationObserver', descriptor);
    return;
  }

  Reflect.deleteProperty(target, 'MutationObserver');
};

test('pollForElement uses the container window MutationObserver when globalThis lacks one', async () => {
  const cleanup = await setupHappyDom();
  const container = document.createElement('div');
  const globalMutationObserver = snapshotProperty(globalThis);

  try {
    document.body.append(container);
    Reflect.deleteProperty(globalThis, 'MutationObserver');

    const waiter = pollForElement(container, 'span', 250);
    globalThis.setTimeout(() => {
      container.append(document.createElement('span'));
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
  const globalMutationObserver = snapshotProperty(globalThis);
  const windowApi = globalThis.window;
  const windowMutationObserver = snapshotProperty(windowApi);

  try {
    document.body.append(container);
    Reflect.deleteProperty(globalThis, 'MutationObserver');
    Object.defineProperty(windowApi, 'MutationObserver', {
      configurable: true,
      value: undefined
    });

    const waiter = pollForElement(container, 'button[title="delayed"]', 250);
    globalThis.setTimeout(() => {
      const button = document.createElement('button');
      button.title = 'delayed';
      container.append(button);
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
