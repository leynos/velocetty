/** @file Verifies Term.reportRenderer emits via transport with deduplication. */
import {afterAll, beforeAll, beforeEach, describe, expect, mock, test} from 'bun:test';

import {setupHappyDom} from '../testUtils/happy-dom';
import {createTransportMock} from '../testUtils/transport-mock';

const {transportMock, resetTransportMock} = createTransportMock();

mock.module('../../lib/transport/electron-ipc-transport', () => ({transport: transportMock}));

// Stub heavy renderer dependencies that Term pulls in transitively.
mock.module('electron', () => ({
  clipboard: {writeText: mock(() => {}), readText: mock(() => '')},
  shell: {openExternal: mock(async () => {})},
  ipcRenderer: {
    invoke: mock(async () => ({})),
    on: mock(() => {}),
    send: mock(() => {}),
    removeAllListeners: mock(() => {}),
    removeListener: mock(() => {})
  }
}));
mock.module('color', () => ({
  default: class Color {
    alpha() {
      return 1;
    }
    hex() {
      return '#000000';
    }
  }
}));
mock.module('xterm', () => ({Terminal: class {}}));
mock.module('xterm-addon-canvas', () => ({CanvasAddon: class {}}));
mock.module('xterm-addon-fit', () => ({FitAddon: class {}}));
mock.module('xterm-addon-image', () => ({ImageAddon: class {}}));
mock.module('xterm-addon-ligatures', () => ({LigaturesAddon: class {}}));
mock.module('xterm-addon-search', () => ({SearchAddon: class {}}));
mock.module('xterm-addon-unicode11', () => ({Unicode11Addon: class {}}));
mock.module('xterm-addon-web-links', () => ({WebLinksAddon: class {}}));
mock.module('xterm-addon-webgl', () => ({WebglAddon: class {}}));
mock.module('xterm/css/xterm.css', () => ({}));
mock.module('../../lib/terms', () => ({default: {}}));
mock.module('../../lib/utils/paste', () => ({default: () => null}));
const createPluginsMock = () => ({
  decorate: (Component: unknown) => Component,
  connect: () => (Component: unknown) => Component,
  getTabProps: (_tab: unknown, _parentProps: unknown, props: unknown) => props,
  subscribeTabDecorationUpdates: () => () => {}
});

mock.module('../../lib/utils/plugins', createPluginsMock);
mock.module('../../lib/utils/plugins.ts', createPluginsMock);
mock.module('../../lib/components/searchBox', () => ({default: () => null}));

let Term: typeof import('../../lib/components/term').default;
let cleanupHappyDom: (() => void) | null = null;

beforeAll(async () => {
  cleanupHappyDom = await setupHappyDom();
  ({default: Term} = await import('../../lib/components/term'));
});

afterAll(() => {
  cleanupHappyDom?.();
  cleanupHappyDom = null;
});

beforeEach(() => {
  resetTransportMock();
  // Reset the static renderer type cache between tests.
  Term.rendererTypes = {};
});

describe('Term.reportRenderer transport emit', () => {
  test('emits info renderer via transport on first call', () => {
    Term.reportRenderer('uid-1', 'WebGL');

    expect(transportMock.emit).toHaveBeenCalledTimes(1);
    expect(transportMock.emit).toHaveBeenCalledWith('info renderer', {uid: 'uid-1', type: 'WebGL'});
  });

  test('deduplicates when called with the same uid and type', () => {
    Term.reportRenderer('uid-2', 'WebGL');
    Term.reportRenderer('uid-2', 'WebGL');

    expect(transportMock.emit).toHaveBeenCalledTimes(1);
  });

  test('emits again when the renderer type changes for the same uid', () => {
    Term.reportRenderer('uid-3', 'WebGL');
    Term.reportRenderer('uid-3', 'Canvas');

    expect(transportMock.emit).toHaveBeenCalledTimes(2);
    expect(transportMock.emit).toHaveBeenLastCalledWith('info renderer', {uid: 'uid-3', type: 'Canvas'});
  });

  test('deduplication is per-uid, not global by type', () => {
    Term.reportRenderer('uid-4', 'WebGL');
    Term.reportRenderer('uid-5', 'WebGL');

    expect(transportMock.emit).toHaveBeenCalledTimes(2);
    expect(transportMock.emit).toHaveBeenCalledWith('info renderer', {uid: 'uid-4', type: 'WebGL'});
    expect(transportMock.emit).toHaveBeenCalledWith('info renderer', {uid: 'uid-5', type: 'WebGL'});
  });
});
