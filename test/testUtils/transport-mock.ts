/** @file Shared renderer transport mock factory for unit tests. */
import {mock} from 'bun:test';

type Listener = (...args: unknown[]) => void;

type TransportMock = {
  invoke: ReturnType<typeof mock>;
  emit: ReturnType<typeof mock>;
  on: ReturnType<typeof mock>;
  once: ReturnType<typeof mock>;
  off: ReturnType<typeof mock>;
  removeAllListeners: ReturnType<typeof mock>;
  destroy: ReturnType<typeof mock>;
};

type TransportMockState = {
  listenersByEvent: Record<string, Listener[]>;
  removedEvents: string[];
};

/**
 * Creates a reusable transport mock and helpers for tests that need to assert
 * subscription lifecycle or event emissions.
 */
export const createTransportMock = (): {
  resetTransportMock: () => void;
  state: TransportMockState;
  transportMock: TransportMock;
} => {
  const state: TransportMockState = {
    listenersByEvent: {},
    removedEvents: []
  };

  /**
   * Emits an event payload to all listeners currently registered for the event.
   */
  const handleEmit = (event: string, ...payload: unknown[]): true => {
    const listeners = state.listenersByEvent[event];
    if (!listeners || listeners.length === 0) {
      return true;
    }

    for (const listener of [...listeners]) {
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
    if (listenerIndex < 0) {
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
    invoke: mock(async () => ({})),
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
