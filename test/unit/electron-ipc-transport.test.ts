/** @file Verifies Electron transport adapter delegates renderer command and event
 * operations correctly.
 */
import {beforeAll, beforeEach, expect, mock, test} from 'bun:test';

const invokeMock = mock(async (_channel: string) => ({payload: 'ok'}));
const emitMock = mock(() => true);
const onMock = mock(() => null);
const onceMock = mock(() => null);
const offMock = mock(() => null);
const removeAllListenersMock = mock(() => null);
const destroyMock = mock(() => null);

const transportOwner: {
  emit: typeof emitMock;
  on: typeof onMock;
  once: typeof onceMock;
  off: typeof offMock;
  removeAllListeners: typeof removeAllListenersMock;
  destroy: typeof destroyMock;
} = {
  emit: emitMock,
  on: onMock,
  once: onceMock,
  off: offMock,
  removeAllListeners: removeAllListenersMock,
  destroy: destroyMock
};

mock.module('../../lib/utils/ipc', () => ({
  ipcRenderer: {
    invoke: invokeMock
  }
}));

mock.module('../../lib/rpc', () => ({
  default: transportOwner
}));

let transport: typeof import('../../lib/transport/electron-ipc-transport').transport;

beforeAll(async () => {
  ({transport} = await import('../../lib/transport/electron-ipc-transport.ts?transport_unit'));
});

beforeEach(() => {
  invokeMock.mockClear();
  emitMock.mockClear();
  onMock.mockClear();
  onceMock.mockClear();
  offMock.mockClear();
  removeAllListenersMock.mockClear();
  destroyMock.mockClear();
});

test('delegates request-response invocation to IPC invoke', async () => {
  await transport.invoke('getDecoratedKeymaps');

  expect(invokeMock).toHaveBeenCalledWith('getDecoratedKeymaps');
});

test('delegates host-command emits to rpc transport', () => {
  transport.emit('command', 'session:search');
  transport.emit('open context menu', 'selection');

  expect(emitMock).toHaveBeenCalledWith('command', 'session:search');
  expect(emitMock).toHaveBeenCalledWith('open context menu', 'selection');
});

test('delegates event-stream subscriptions and cleanup to rpc transport', () => {
  const sessionDataHandler = mock(() => {});
  const sessionAddHandler = mock(() => {});

  expect(transport.on('session data', sessionDataHandler)).toBe(transport);
  expect(transport.once('session add', sessionAddHandler)).toBe(transport);
  expect(transport.off('session add', sessionAddHandler)).toBe(transport);

  transport.removeAllListeners();
  transport.destroy?.();

  expect(onMock).toHaveBeenCalledWith('session data', sessionDataHandler);
  expect(onceMock).toHaveBeenCalledWith('session add', sessionAddHandler);
  expect(offMock).toHaveBeenCalledWith('session add', sessionAddHandler);
  expect(removeAllListenersMock).toHaveBeenCalledTimes(1);
  expect(destroyMock).toHaveBeenCalledTimes(1);
});
