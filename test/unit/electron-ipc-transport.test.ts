/** @file Verifies Electron transport adapter delegates renderer command and event
 * operations correctly.
 */
import {beforeAll, beforeEach, expect, mock, test} from 'bun:test';
import {ZodError} from 'zod';
import {asCommandId} from '@shared/types/commands';

import type {IpcResult} from '@shared/types/common';

import {importFresh} from '../testUtils/import-fresh';
import {registerModuleMock} from '../testUtils/mock-module';

// The reply is left as `IpcResult`: the transport validates every answer with a
// schema, and the rejection test resolves a string where the schema declares a
// record. Both are values the declared command map can produce, so the double
// stays honest about the transport under test rather than widening to
// `unknown` to admit the mismatched case.
const invokeMock = mock(async (_channel: string): Promise<IpcResult> => ({'editor:break': ['ctrl+c']}));
const emitMock = mock(() => true);
const onMock = mock(() => null);
const onceMock = mock(() => null);
const offMock = mock(() => null);
const removeAllListenersMock = mock(() => null);
const destroyMock = mock(() => null);

type TransportOwner = {
  emit: typeof emitMock;
  on: typeof onMock;
  once: typeof onceMock;
  off: typeof offMock;
  removeAllListeners: typeof removeAllListenersMock;
  destroy: typeof destroyMock;
};

const transportOwner: TransportOwner = {
  emit: emitMock,
  on: onMock,
  once: onceMock,
  off: offMock,
  removeAllListeners: removeAllListenersMock,
  destroy: destroyMock
};

registerModuleMock('../../lib/utils/ipc', () => ({
  ipcRenderer: {
    invoke: invokeMock
  }
}));

registerModuleMock('../../lib/rpc', () => ({
  default: transportOwner
}));

let transport: typeof import('../../lib/transport/electron-ipc-transport').transport;

beforeAll(async () => {
  ({transport} = await importFresh<typeof import('../../lib/transport/electron-ipc-transport')>(
    '../../lib/transport/electron-ipc-transport',
    'transport_unit'
  ));
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
  const result = await transport.invoke('getDecoratedKeymaps');

  expect(invokeMock).toHaveBeenCalledWith('getDecoratedKeymaps');
  expect(result).toEqual({'editor:break': ['ctrl+c']});
});

test('rejects with ZodError when IPC response fails schema validation', async () => {
  invokeMock.mockResolvedValueOnce('not-a-record');

  await expect(transport.invoke('getDecoratedKeymaps')).rejects.toBeInstanceOf(ZodError);
});

test('delegates host-command emits to rpc transport', () => {
  transport.emit('command', asCommandId('session:search'));
  transport.emit('open context menu', 'selection');

  expect(emitMock).toHaveBeenCalledWith('command', asCommandId('session:search'));
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

test('forwards event argument to rpc removeAllListeners when provided', () => {
  expect(transport.removeAllListeners('session data')).toBe(transport);

  expect(removeAllListenersMock).toHaveBeenCalledWith('session data');
});
