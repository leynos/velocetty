/**
 * @file Adapter from channel-dispatching test doubles to the renderer transport.
 *
 * A test double that answers IPC by comparing the channel string cannot be
 * written as the transport's generic `invoke` signature: the compiler knows
 * the double returns *some* channel's result, not the result belonging to
 * whichever `Command` the caller instantiates. This adapter is the one place
 * that gap is stated, so individual suites can keep their doubles readable.
 *
 * Cross-link: `shared/src/types/transport.ts`.
 */
import type {IpcResult} from '@shared/types/common';
import type {RendererCommandTransport} from '@shared/types/transport';

/**
 * Presents a channel-dispatching double as a typed command transport.
 *
 * @param invoke - Double that dispatches on the channel name.
 * @returns The same function, typed as the transport's `invoke`.
 *
 * @example
 * ```ts
 * const transport = {invoke: asCommandInvoker(invokeMock)};
 * ```
 */
export const asCommandInvoker = (
  invoke: (channel: string, ...args: unknown[]) => Promise<IpcResult>
): RendererCommandTransport['invoke'] => {
  // SAFETY: the double returns the declared result for each channel it
  // answers; dispatch on a runtime value is invisible to the generic return
  // type, so the adapter supplies the correspondence the compiler cannot see.
  return invoke as RendererCommandTransport['invoke'];
};
