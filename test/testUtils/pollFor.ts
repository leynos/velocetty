/**
 * @file Polling helper for DOM elements using MutationObserver.
 *
 * Resolves once `predicate` returns truthy, or rejects after `timeoutMs`.
 * Uses MutationObserver so there is no fixed sleep — it reacts to DOM changes.
 */

/**
 * Polls for an element matching `selector` within `container`.
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
export const pollForElement = (container: ParentNode, selector: string, timeoutMs = 2000): Promise<Element> =>
  new Promise((resolve, reject) => {
    const existing = container.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`pollForElement: "${selector}" not found within ${timeoutMs} ms`));
    }, timeoutMs);

    const observer = new MutationObserver(() => {
      const el = container.querySelector(selector);
      if (el) {
        clearTimeout(timer);
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(container, {childList: true, subtree: true, attributes: true});
  });
