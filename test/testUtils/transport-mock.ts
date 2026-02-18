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
  listenersByEvent: Record<string, Listener>;
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
    emit: mock(() => true),
    on: mock((event: string, listener: Listener) => {
      state.listenersByEvent[event] = listener;
      return transportMock;
    }),
    once: mock((_event: string, _listener: Listener) => transportMock),
    off: mock((event: string, _listener: Listener) => {
      state.removedEvents.push(event);
      return transportMock;
    }),
    removeAllListeners: mock((_event?: string) => transportMock),
    destroy: mock(() => {})
  };

  const resetTransportMock = () => {
    for (const event of Object.keys(state.listenersByEvent)) {
      delete state.listenersByEvent[event];
    }
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
