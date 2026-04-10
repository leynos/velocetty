/**
 * @file Polling helper for DOM elements using MutationObserver.
 *
 * `pollForElement(container, selector, timeoutMs)` resolves once an element
 * matching `selector` is found within `container`, or rejects after
 * `timeoutMs`.
 * Uses MutationObserver so there is no fixed sleep — it reacts to DOM changes.
 */

/**
 * Polls for an element matching `selector` within `container`.
 *
 * Resolves when a matching element is found within the container, or rejects
 * after `timeoutMs`.
 *
 * @param container - The parent node to search within.
 * @param selector - The CSS selector to match.
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 2000).
 * @returns Promise that resolves with the found element.
 * @throws Error if the element is not found within the timeout.
 *
 * @example
 * ```ts
 * const {container, teardown} = await renderSearchBox(overrides);
 * const output = await pollForElement(container, 'output');
 * expect(output.textContent?.trim()).toBe('expected');
 * ```
 */
const getContainerDocument = (container: ParentNode): Document | null => {
  if ('ownerDocument' in container && container.ownerDocument) {
    return container.ownerDocument;
  }

  if ('defaultView' in container) {
    return container as Document;
  }

  return null;
};

export const pollForElement = (container: ParentNode, selector: string, timeoutMs = 2000): Promise<Element> =>
  new Promise((resolve, reject) => {
    const getElement = () => container.querySelector(selector);
    const existing = getElement();
    if (existing) {
      resolve(existing);
      return;
    }

    const containerDocument = getContainerDocument(container);
    const windowMutationObserver = containerDocument?.defaultView?.MutationObserver;
    const MutationObserverCtor = windowMutationObserver ?? globalThis.MutationObserver;
    let observer: MutationObserver | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      clearTimeout(timer);
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      observer?.disconnect();
    };

    const resolveIfPresent = () => {
      const el = getElement();
      if (el) {
        cleanup();
        resolve(el);
        return true;
      }

      return false;
    };

    const schedulePoll = () => {
      pollTimer = setTimeout(() => {
        if (!resolveIfPresent()) {
          schedulePoll();
        }
      }, 16);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`pollForElement: "${selector}" not found within ${timeoutMs} ms`));
    }, timeoutMs);

    observer = MutationObserverCtor
      ? new MutationObserverCtor(() => {
          resolveIfPresent();
        })
      : null;

    observer?.observe(container as Node, {childList: true, subtree: true, attributes: true});

    schedulePoll();

    resolveIfPresent();
  });
