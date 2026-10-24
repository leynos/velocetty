/** @file Shared renderer transport mock factory for unit tests. */
import {mock} from 'bun:test';

import type {IpcResult} from '@shared/types/common';

type Listener = (...args: unknown[]) => void;

type TransportMockState = {
  listenersByEvent: Partial<Record<string, Listener[]>>;
  removedEvents: string[];
};

/**
 * Creates a reusable transport mock and helpers for tests that need to assert
 * subscription lifecycle or event emissions.
 */
export const createTransportMock = () => {
  const state: TransportMockState = {
    listenersByEvent: {},
    removedEvents: []
  };

  /**
   * Emits an event payload to the listeners registered for the event when
   * emission begins.
   */
  const handleEmit = (event: string, ...payload: unknown[]): boolean => {
    const listeners = state.listenersByEvent[event];
    if (!listeners || listeners.length === 0) {
      return false;
    }

    // Snapshot before dispatch, as Node's EventEmitter does. The `once`
    // wrapper removes itself while it runs, which splices the live array and
    // would otherwise skip whichever listener shifted into the vacated slot.
    // The copy is hoisted into its own binding because spreading directly in
    // the `for…of` header is reported as a redundant conversion.
    const listenersToNotify = [...listeners];
    for (const listener of listenersToNotify) {
      listener(...payload);
    }
    return true;
  };

  /**
   * Removes a specific listener from an event registration list and
   * deletes the event entry when no listeners remain.
   */
  const handleRemoveListener = (event: string, listener: Listener): void => {
    const listeners = state.listenersByEvent[event];
    if (!listeners || listeners.length === 0) {
      return;
    }

    const listenerIndex = listeners.indexOf(listener);
    if (listenerIndex === -1) {
      return;
    }

    listeners.splice(listenerIndex, 1);
    if (listeners.length > 0) {
      state.listenersByEvent[event] = listeners;
      return;
    }

    delete state.listenersByEvent[event];
  };

  /**
   * Registers a listener for an event by appending it to the event's
   * listener list.
   */
  const registerListener = (event: string, listener: Listener): void => {
    state.listenersByEvent[event] = [...(state.listenersByEvent[event] ?? []), listener];
  };

  const transportMock = {
    // The channel is declared even though the default answer ignores it: a
    // parameterless double rejects every `mockImplementation` that reads the
    // channel, which is how the paste tests choose their reply.
    invoke: mock(async (_channel: string, ..._args: unknown[]): Promise<IpcResult> => ({})),
    emit: mock((event: string, ...payload: unknown[]) => handleEmit(event, ...payload)),
    on: mock((event: string, listener: Listener) => {
      registerListener(event, listener);
      return transportMock;
    }),
    once: mock((event: string, listener: Listener) => {
      const onceListener: Listener = (...payload: unknown[]) => {
        transportMock.off(event, onceListener);
        listener(...payload);
      };
      registerListener(event, onceListener);
      return transportMock;
    }),
    off: mock((event: string, listener: Listener) => {
      handleRemoveListener(event, listener);
      state.removedEvents.push(event);
      return transportMock;
    }),
    removeAllListeners: mock((event?: string) => {
      if (event) {
        delete state.listenersByEvent[event];
      } else {
        state.listenersByEvent = {};
      }
      return transportMock;
    }),
    destroy: mock(() => {})
  };

  const resetTransportMock = () => {
    state.listenersByEvent = {};
    state.removedEvents.length = 0;
    transportMock.invoke.mockClear();
    transportMock.emit.mockClear();
    transportMock.on.mockClear();
    transportMock.once.mockClear();
    transportMock.off.mockClear();
    transportMock.removeAllListeners.mockClear();
    transportMock.destroy.mockClear();
  };

  return {transportMock, state, resetTransportMock};
};
