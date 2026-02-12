/** @file Shared transport contracts for command invocation and event streams. */
import type {IpcCommands, MainEvents, RendererEvents} from './common';
import type {FilterNever} from './common';

/** Transport contract for renderer-side command dispatch and event subscription. */
export interface RendererCommandTransport {
  /** Invoke a request-response IPC command. */
  invoke<Command extends keyof IpcCommands>(
    channel: Command,
    ...args: Parameters<IpcCommands[Command]>
  ): Promise<ReturnType<IpcCommands[Command]>>;

  /** Emit an event to the host from the renderer. */
  emit<Event extends Exclude<keyof MainEvents, FilterNever<MainEvents>>>(event: Event): boolean;
  emit<Event extends FilterNever<MainEvents>>(event: Event, payload: MainEvents[Event]): boolean;

  /** Register renderer event handlers for host event streams. */
  on<Event extends keyof RendererEvents>(
    event: Event,
    listener: (payload: RendererEvents[Event]) => void
  ): RendererCommandTransport;

  /** Register renderer one-time handlers for host event streams. */
  once<Event extends keyof RendererEvents>(
    event: Event,
    listener: (payload: RendererEvents[Event]) => void
  ): RendererCommandTransport;

  /** Remove a renderer event handler for host event streams. */
  off<Event extends keyof RendererEvents>(
    event: Event,
    listener: (payload: RendererEvents[Event]) => void
  ): RendererCommandTransport;

  /** Remove all host event handlers from this transport. */
  removeAllListeners: () => void;

  /** Dispose resources created by the transport. */
  destroy?(): void;
}
