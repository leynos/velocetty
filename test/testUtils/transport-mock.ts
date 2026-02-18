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

  const transportMock = {
    invoke: mock(async () => ({})),
    emit: mock((event: string, ...payload: unknown[]) => {
      const listeners = state.listenersByEvent[event];
      if (!listeners || listeners.length === 0) {
        return true;
      }

      for (const listener of [...listeners]) {
        listener(...payload);
      }
      return true;
    }),
    on: mock((event: string, listener: Listener) => {
      state.listenersByEvent[event] = [...(state.listenersByEvent[event] ?? []), listener];
      return transportMock;
    }),
    once: mock((_event: string, _listener: Listener) => transportMock),
    off: mock((event: string, listener: Listener) => {
      const listeners = state.listenersByEvent[event];
      if (listeners && listeners.length > 0) {
        const listenerIndex = listeners.indexOf(listener);
        if (listenerIndex >= 0) {
          listeners.splice(listenerIndex, 1);
        }
        if (listeners.length > 0) {
          state.listenersByEvent[event] = listeners;
        } else {
          delete state.listenersByEvent[event];
        }
      }
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
