/**
 * @file Registers Bun module mocks and proves the registration was synchronous.
 *
 * `bun:test` declares `mock.module` as returning `void | Promise<void>`: a
 * factory that returns a promise leaves the exports overwritten only once that
 * promise settles. Every mock in this suite answers synchronously, so a
 * registration that returned a promise would mean a test raced its own
 * fixture. This wrapper states that expectation once, instead of leaving every
 * call site looking like an unhandled promise.
 *
 * @example
 * ```ts
 * registerModuleMock('uuid', () => ({v4: () => 'test-rpc-id'}));
 * ```
 */
import {mock} from 'bun:test';

/** Registers `factory` as the exports of `id`, failing if that ever defers. */
export const registerModuleMock = <Exports>(id: string, factory: () => Exports): void => {
  const registration: void | Promise<void> = mock.module(id, factory);
  if (registration) {
    throw new Error(`Module mock for ${id} registered asynchronously; await the registration instead.`);
  }
};
