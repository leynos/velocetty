/** @file Asserts bootstrap stream handlers use transport-on callbacks. */
import {beforeEach, describe, expect, mock, test} from 'bun:test';

import type {Session} from '@shared/types/common';

import {
  registerTransportListeners,
  type AddNotificationParams,
  type AddSessionDataParams,
  type SendSessionDataParams,
  type SplitRequestParams,
  type UpdateAvailableParams
} from '../../lib/bootstrap/renderer-bootstrap';

const dispatchMock = mock((_action: unknown) => {});
const transportOnCalls: Record<string, Array<(...args: unknown[]) => void>> = {};

type Listener = (payload: unknown) => void;

const transport = {
  invoke: mock(async () => ({})),
  emit: mock(() => true),
  off: mock((_event: string, _listener: Listener) => transport),
  once: mock((_event: string, _listener: Listener) => transport),
  removeAllListeners: mock((_event?: string) => transport),
  destroy: mock(() => {}),
  on: mock((event: string, listener: Listener) => {
    transportOnCalls[event] = transportOnCalls[event] ? [...transportOnCalls[event], listener] : [listener];
    return transport;
  })
};

const store = {
  dispatch: dispatchMock,
  getState: () => ({
    ui: {bellSoundURL: 'sound.wav', bellSound: 'abc', bell: 'SOUND'},
    sessions: {activeUid: 'session-0', sessions: {}},
    termGroups: {termGroups: {}, activeSessions: {}, activeRootGroup: null}
  })
};

const init = () => ({type: 'INIT_ACTION'});
const addNotificationMessage = ({text, url, dismissable}: AddNotificationParams) => ({
  type: 'ADD_NOTIFICATION',
  text,
  url,
  dismissable
});
const sessionActions = {
  addSession: (session: unknown) => ({type: 'SESSION_ADD', session}),
  addSessionData: ({uid, data}: AddSessionDataParams) => ({type: 'SESSION_DATA', uid, data}),
  sendSessionData: ({uid, data, escaped}: SendSessionDataParams) => ({
    type: 'SESSION_DATA_SEND',
    uid,
    data,
    ...(escaped !== undefined && {escaped})
  }),
  openSearch: () => ({type: 'SESSION_SEARCH'}),
  closeSearch: () => ({type: 'SESSION_SEARCH_CLOSE'}),
  clearActiveSession: () => ({type: 'SESSION_CLEAR_ACTIVE'}),
  ptyExitTermGroup: (uid: string) => ({type: 'PTY_EXIT_TERM_GROUP', uid}),
  userExitSession: (uid: string) => ({type: 'USER_EXIT_SESSION', uid}),
  createExitAction: () => () => ({type: 'CREATE_EXIT_ACTION'})
};
const termGroupActions = {
  requestTermGroup: ({activeUid, profile}: SplitRequestParams = {}) => ({
    type: 'TERM_GROUP_REQUEST',
    activeUid,
    profile
  }),
  requestHorizontalSplit: ({activeUid, profile}: SplitRequestParams = {}) => ({
    type: 'TERM_GROUP_SPLIT_HORIZONTAL',
    activeUid,
    profile
  }),
  requestVerticalSplit: ({activeUid, profile}: SplitRequestParams = {}) => ({
    type: 'TERM_GROUP_SPLIT_VERTICAL',
    activeUid,
    profile
  }),
  exitActiveTermGroup: () => ({type: 'TERM_GROUP_EXIT_ACTIVE'}),
  ptyExitTermGroup: (uid: string) => ({type: 'PTY_EXIT_TERM_GROUP', uid})
};
const uiActions = {
  setFontSmoothing: () => ({type: 'UI_SET_FONT_SMOOTHING'}),
  resetFontSize: () => ({type: 'UI_RESET_FONT_SIZE'}),
  increaseFontSize: () => ({type: 'UI_INCREASE_FONT_SIZE'}),
  decreaseFontSize: () => ({type: 'UI_DECREASE_FONT_SIZE'}),
  moveLeft: () => ({type: 'UI_MOVE_LEFT'}),
  moveRight: () => ({type: 'UI_MOVE_RIGHT'}),
  moveTo: (index: number | 'last') => ({type: 'UI_MOVE_TO', index}),
  moveToNextPane: () => ({type: 'UI_MOVE_NEXT_PANE'}),
  moveToPreviousPane: () => ({type: 'UI_MOVE_PREVIOUS_PANE'}),
  openFile: (path: string) => ({type: 'UI_OPEN_FILE', path}),
  openSSH: (parsedUrl: unknown) => ({type: 'UI_OPEN_SSH', parsedUrl}),
  windowGeometryUpdated: (data: {isMaximized: boolean}) => ({type: 'UI_WINDOW_GEOMETRY_UPDATED', data}),
  windowMove: (windowState: {bounds: {x: number; y: number}}) => ({type: 'UI_WINDOW_MOVE', window: windowState}),
  enterFullScreen: () => ({type: 'UI_ENTER_FULL_SCREEN'}),
  leaveFullScreen: () => ({type: 'UI_LEAVE_FULL_SCREEN'})
};
const updaterActions = {
  updateAvailable: ({releaseName, notes, releaseUrl, canInstall}: UpdateAvailableParams) => ({
    type: 'UPDATE_AVAILABLE',
    releaseName,
    notes,
    releaseUrl,
    canInstall
  })
};
const pluginsReloadMock = mock(() => {});
const plugins = {
  reload: pluginsReloadMock
};

const getListener = (event: string): Listener => {
  const handlers = transportOnCalls[event];
  if (!handlers || handlers.length === 0) {
    throw new Error(`Expected transport listener for ${event}`);
  }
  return handlers[handlers.length - 1];
};

const registerBootstrapTransportListeners = () => {
  dispatchMock.mockClear();
  pluginsReloadMock.mockClear();
  transport.invoke.mockClear();
  transport.emit.mockClear();
  transport.off.mockClear();
  transport.once.mockClear();
  transport.removeAllListeners.mockClear();
  transport.destroy.mockClear();
  transport.on.mockClear();
  Object.keys(transportOnCalls).forEach((key) => {
    transportOnCalls[key] = [];
  });

  registerTransportListeners({
    actions: {
      addNotificationMessage,
      init,
      loadConfig: mock((_config: unknown) => ({type: 'LOAD_CONFIG'})),
      reloadConfig: mock((_config: unknown) => ({type: 'RELOAD_CONFIG'})),
      sessionActions,
      termGroupActions,
      uiActions,
      updaterActions
    },
    plugins,
    store,
    transport
  });
};

describe('bootstrap transport event wiring', () => {
  beforeEach(() => {
    registerBootstrapTransportListeners();
  });

  const clearDispatch = () => dispatchMock.mockClear();

  test('registers all expected transport listeners', () => {
    const expectedEvents = [
      'ready',
      'session add',
      'session data',
      'session data send',
      'session exit',
      'session clear req',
      'session move word left req',
      'session move word right req',
      'session move line beginning req',
      'session move line end req',
      'session del word left req',
      'session del word right req',
      'session del line beginning req',
      'session del line end req',
      'session break req',
      'session stop req',
      'session quit req',
      'session tmux req',
      'session search',
      'session search close',
      'termgroup close req',
      'termgroup add req',
      'split request horizontal',
      'split request vertical',
      'reset fontSize req',
      'increase fontSize req',
      'decrease fontSize req',
      'move left req',
      'move right req',
      'move jump req',
      'next pane req',
      'prev pane req',
      'open file',
      'open ssh',
      'move',
      'enter full screen',
      'leave full screen',
      'windowGeometry change',
      'add notification',
      'update available',
      'reload'
    ];

    const registeredEvents = transport.on.mock.calls.map(([name]: [string]) => name);

    expect(registeredEvents).toHaveLength(expectedEvents.length);
    expect([...registeredEvents].sort()).toEqual([...expectedEvents].sort());

    for (const event of expectedEvents) {
      expect(transport.on.mock.calls).toContainEqual([event, expect.any(Function)]);
    }
  });

  test('ready dispatches init and font smoothing', () => {
    clearDispatch();
    getListener('ready')(null);

    expect(dispatchMock.mock.calls).toContainEqual([{type: 'INIT_ACTION'}]);
    expect(dispatchMock.mock.calls).toContainEqual([{type: 'UI_SET_FONT_SMOOTHING'}]);
  });

  test('session add event dispatches SESSION_ADD actions', () => {
    clearDispatch();

    getListener('session add')({uid: 's-1', shell: '/bin/bash', pid: 100, profile: 'default'} as unknown as Session);
    getListener('session add')({uid: 's-2', shell: '/bin/bash', pid: 101, profile: 'default'} as unknown as Session);
    expect(dispatchMock.mock.calls).toContainEqual([
      {type: 'SESSION_ADD', session: {uid: 's-1', shell: '/bin/bash', pid: 100, profile: 'default'}}
    ]);
    expect(dispatchMock.mock.calls).toContainEqual([
      {type: 'SESSION_ADD', session: {uid: 's-2', shell: '/bin/bash', pid: 101, profile: 'default'}}
    ]);
    expect(dispatchMock.mock.calls.filter((call) => call[0]?.type === 'SESSION_ADD')).toHaveLength(2);
  });

  test('session data event dispatches SESSION_DATA action', () => {
    clearDispatch();

    const uid = '01234567-89ab-cdef-0123-456789abcdef';
    getListener('session data')(`${uid}hello world`);
    expect(dispatchMock.mock.calls).toContainEqual([{type: 'SESSION_DATA', uid, data: 'hello world'}]);
  });

  test('session exit event dispatches PTY_EXIT_TERM_GROUP action', () => {
    clearDispatch();

    getListener('session exit')({uid: 's-1'});
    expect(dispatchMock.mock.calls).toContainEqual([{type: 'PTY_EXIT_TERM_GROUP', uid: 's-1'}]);
  });

  test('reload invokes plugins.reload', () => {
    pluginsReloadMock.mockClear();
    getListener('reload')(null);
    expect(pluginsReloadMock).toHaveBeenCalledTimes(1);
  });

  test('update available dispatches UPDATE_AVAILABLE', () => {
    clearDispatch();
    getListener('update available')({
      releaseName: 'v0.0.1',
      releaseNotes: 'notes',
      releaseUrl: 'https://example.org',
      canInstall: true
    });
    expect(dispatchMock.mock.calls).toContainEqual([
      {
        type: 'UPDATE_AVAILABLE',
        releaseName: 'v0.0.1',
        notes: 'notes',
        releaseUrl: 'https://example.org',
        canInstall: true
      }
    ]);
  });

  test('session data send dispatches SESSION_DATA_SEND with escaped flag', () => {
    clearDispatch();
    getListener('session data send')({uid: 's-1', data: 'input', escaped: true});
    expect(dispatchMock.mock.calls).toContainEqual([
      {type: 'SESSION_DATA_SEND', uid: 's-1', data: 'input', escaped: true}
    ]);
  });

  test('session shortcut events dispatch sendSessionData with escape sequences', () => {
    clearDispatch();
    const cases: Array<{event: string; data: string}> = [
      {event: 'session move word left req', data: '\x1bb'},
      {event: 'session move word right req', data: '\x1bf'},
      {event: 'session move line beginning req', data: '\x1bOH'},
      {event: 'session move line end req', data: '\x1bOF'},
      {event: 'session del word left req', data: '\x1b\x7f'},
      {event: 'session del word right req', data: '\x1bd'},
      {event: 'session del line beginning req', data: '\x1bw'},
      {event: 'session del line end req', data: '\x10B'},
      {event: 'session break req', data: '\x03'},
      {event: 'session stop req', data: '\x1a'},
      {event: 'session quit req', data: '\x1c'},
      {event: 'session tmux req', data: '\x02'}
    ];
    for (const {event, data} of cases) {
      getListener(event)(null);
      expect(dispatchMock.mock.calls).toContainEqual([{type: 'SESSION_DATA_SEND', uid: null, data}]);
    }
  });

  test('parameterless events dispatch correct actions', () => {
    clearDispatch();
    const cases: Array<{event: string; actionType: string}> = [
      {event: 'session clear req', actionType: 'SESSION_CLEAR_ACTIVE'},
      {event: 'session search', actionType: 'SESSION_SEARCH'},
      {event: 'session search close', actionType: 'SESSION_SEARCH_CLOSE'},
      {event: 'termgroup close req', actionType: 'TERM_GROUP_EXIT_ACTIVE'},
      {event: 'reset fontSize req', actionType: 'UI_RESET_FONT_SIZE'},
      {event: 'increase fontSize req', actionType: 'UI_INCREASE_FONT_SIZE'},
      {event: 'decrease fontSize req', actionType: 'UI_DECREASE_FONT_SIZE'},
      {event: 'move left req', actionType: 'UI_MOVE_LEFT'},
      {event: 'move right req', actionType: 'UI_MOVE_RIGHT'},
      {event: 'next pane req', actionType: 'UI_MOVE_NEXT_PANE'},
      {event: 'prev pane req', actionType: 'UI_MOVE_PREVIOUS_PANE'},
      {event: 'enter full screen', actionType: 'UI_ENTER_FULL_SCREEN'},
      {event: 'leave full screen', actionType: 'UI_LEAVE_FULL_SCREEN'}
    ];
    for (const {event, actionType} of cases) {
      getListener(event)(null);
      expect(dispatchMock.mock.calls).toContainEqual([{type: actionType}]);
    }
  });

  test('payload-bearing events dispatch correct actions', () => {
    clearDispatch();

    getListener('termgroup add req')({activeUid: 's-1', profile: 'default'});
    expect(dispatchMock.mock.calls).toContainEqual([
      {type: 'TERM_GROUP_REQUEST', activeUid: 's-1', profile: 'default'}
    ]);

    getListener('split request horizontal')({activeUid: 's-1', profile: 'default'});
    expect(dispatchMock.mock.calls).toContainEqual([
      {type: 'TERM_GROUP_SPLIT_HORIZONTAL', activeUid: 's-1', profile: 'default'}
    ]);

    getListener('split request vertical')({activeUid: 's-1', profile: 'default'});
    expect(dispatchMock.mock.calls).toContainEqual([
      {type: 'TERM_GROUP_SPLIT_VERTICAL', activeUid: 's-1', profile: 'default'}
    ]);

    getListener('move jump req')(3);
    expect(dispatchMock.mock.calls).toContainEqual([{type: 'UI_MOVE_TO', index: 3}]);

    getListener('open file')({path: '/tmp/test.txt'});
    expect(dispatchMock.mock.calls).toContainEqual([{type: 'UI_OPEN_FILE', path: '/tmp/test.txt'}]);

    getListener('add notification')({text: 'hello', url: 'https://example.org', dismissable: true});
    expect(dispatchMock.mock.calls).toContainEqual([
      {type: 'ADD_NOTIFICATION', text: 'hello', url: 'https://example.org', dismissable: true}
    ]);

    getListener('move')({bounds: {x: 100, y: 200}});
    expect(dispatchMock.mock.calls).toContainEqual([{type: 'UI_WINDOW_MOVE', window: {bounds: {x: 100, y: 200}}}]);

    getListener('windowGeometry change')({isMaximized: false});
    expect(dispatchMock.mock.calls).toContainEqual([{type: 'UI_WINDOW_GEOMETRY_UPDATED', data: {isMaximized: false}}]);
  });

  test('ordered bootstrap sequence: ready → session add → session data', () => {
    clearDispatch();

    getListener('ready')(null);
    getListener('session add')({
      uid: 'seq-1',
      shell: '/bin/bash',
      pid: 200,
      profile: 'default'
    } as unknown as Session);
    const uid = '01234567-89ab-cdef-0123-456789abcdef';
    getListener('session data')(`${uid}initial output`);
    getListener('update available')({
      releaseName: 'v1.0.0',
      releaseNotes: 'release',
      releaseUrl: 'https://example.org',
      canInstall: false
    });

    const types = dispatchMock.mock.calls.map((call) => call[0]?.type as string);
    const initIdx = types.indexOf('INIT_ACTION');
    const fontIdx = types.indexOf('UI_SET_FONT_SMOOTHING');
    const addIdx = types.indexOf('SESSION_ADD');
    const dataIdx = types.indexOf('SESSION_DATA');
    const updateIdx = types.indexOf('UPDATE_AVAILABLE');

    expect(initIdx).toBeGreaterThanOrEqual(0);
    expect(fontIdx).toBeGreaterThan(initIdx);
    expect(addIdx).toBeGreaterThan(fontIdx);
    expect(dataIdx).toBeGreaterThan(addIdx);
    expect(updateIdx).toBeGreaterThan(dataIdx);
  });

  test('high-frequency session data: 100 events dispatch correctly', () => {
    clearDispatch();

    const uid = '01234567-89ab-cdef-0123-456789abcdef';
    const count = 100;

    for (let index = 0; index < count; index += 1) {
      getListener('session data')(`${uid}chunk-${index}`);
    }

    const dataActions = dispatchMock.mock.calls.filter((call) => call[0]?.type === 'SESSION_DATA');

    expect(dataActions).toHaveLength(count);

    for (let index = 0; index < count; index += 1) {
      expect(dataActions[index][0]).toEqual({
        type: 'SESSION_DATA',
        uid,
        data: `chunk-${index}`
      });
    }
  });

  test('ready prerequisite: session add and data dispatch after ready', () => {
    clearDispatch();

    getListener('ready')(null);
    getListener('session add')({
      uid: 'prereq-1',
      shell: '/bin/zsh',
      pid: 300,
      profile: 'default'
    } as unknown as Session);
    const uid = '01234567-89ab-cdef-0123-456789abcdef';
    getListener('session data')(`${uid}post-ready output`);

    expect(dispatchMock.mock.calls).toContainEqual([{type: 'INIT_ACTION'}]);
    expect(dispatchMock.mock.calls).toContainEqual([
      {
        type: 'SESSION_ADD',
        session: {uid: 'prereq-1', shell: '/bin/zsh', pid: 300, profile: 'default'}
      }
    ]);
    expect(dispatchMock.mock.calls).toContainEqual([{type: 'SESSION_DATA', uid, data: 'post-ready output'}]);

    const types = dispatchMock.mock.calls.map((call) => call[0]?.type as string);
    const initIdx = types.indexOf('INIT_ACTION');
    const addIdx = types.indexOf('SESSION_ADD');
    const dataIdx = types.indexOf('SESSION_DATA');
    expect(addIdx).toBeGreaterThan(initIdx);
    expect(dataIdx).toBeGreaterThan(initIdx);
  });
});
