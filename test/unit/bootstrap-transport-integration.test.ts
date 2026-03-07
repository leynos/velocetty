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

const TransportEvent = {
  Ready: 'ready',
  AddNotification: 'add notification',
  UpdateAvailable: 'update available',
  Reload: 'reload',
  SessionAdd: 'session add',
  SessionData: 'session data',
  SessionDataSend: 'session data send',
  SessionExit: 'session exit',
  SessionClearReq: 'session clear req',
  SessionMoveWordLeftReq: 'session move word left req',
  SessionMoveWordRightReq: 'session move word right req',
  SessionMoveLineBeginReq: 'session move line beginning req',
  SessionMoveLineEndReq: 'session move line end req',
  SessionDelWordLeftReq: 'session del word left req',
  SessionDelWordRightReq: 'session del word right req',
  SessionDelLineBeginReq: 'session del line beginning req',
  SessionDelLineEndReq: 'session del line end req',
  SessionBreakReq: 'session break req',
  SessionStopReq: 'session stop req',
  SessionQuitReq: 'session quit req',
  SessionTmuxReq: 'session tmux req',
  SessionSearch: 'session search',
  SessionSearchClose: 'session search close',
  TermGroupCloseReq: 'termgroup close req',
  TermGroupAddReq: 'termgroup add req',
  SplitHorizontal: 'split request horizontal',
  SplitVertical: 'split request vertical',
  ResetFontSizeReq: 'reset fontSize req',
  IncreaseFontSizeReq: 'increase fontSize req',
  DecreaseFontSizeReq: 'decrease fontSize req',
  MoveLeftReq: 'move left req',
  MoveRightReq: 'move right req',
  MoveJumpReq: 'move jump req',
  NextPaneReq: 'next pane req',
  PrevPaneReq: 'prev pane req',
  OpenFile: 'open file',
  OpenSsh: 'open ssh',
  Move: 'move',
  EnterFullScreen: 'enter full screen',
  LeaveFullScreen: 'leave full screen',
  WindowGeometryChange: 'windowGeometry change'
} as const;

const ActionType = {
  InitAction: 'INIT_ACTION',
  LoadConfig: 'LOAD_CONFIG',
  ReloadConfig: 'RELOAD_CONFIG',
  AddNotification: 'ADD_NOTIFICATION',
  UpdateAvailable: 'UPDATE_AVAILABLE',
  SessionAdd: 'SESSION_ADD',
  SessionData: 'SESSION_DATA',
  SessionDataSend: 'SESSION_DATA_SEND',
  SessionSearch: 'SESSION_SEARCH',
  SessionSearchClose: 'SESSION_SEARCH_CLOSE',
  SessionClearActive: 'SESSION_CLEAR_ACTIVE',
  UserExitSession: 'USER_EXIT_SESSION',
  CreateExitAction: 'CREATE_EXIT_ACTION',
  PtyExitTermGroup: 'PTY_EXIT_TERM_GROUP',
  TermGroupRequest: 'TERM_GROUP_REQUEST',
  TermGroupSplitHoriz: 'TERM_GROUP_SPLIT_HORIZONTAL',
  TermGroupSplitVert: 'TERM_GROUP_SPLIT_VERTICAL',
  TermGroupExitActive: 'TERM_GROUP_EXIT_ACTIVE',
  UiSetFontSmoothing: 'UI_SET_FONT_SMOOTHING',
  UiResetFontSize: 'UI_RESET_FONT_SIZE',
  UiIncreaseFontSize: 'UI_INCREASE_FONT_SIZE',
  UiDecreaseFontSize: 'UI_DECREASE_FONT_SIZE',
  UiMoveLeft: 'UI_MOVE_LEFT',
  UiMoveRight: 'UI_MOVE_RIGHT',
  UiMoveTo: 'UI_MOVE_TO',
  UiMoveNextPane: 'UI_MOVE_NEXT_PANE',
  UiMovePreviousPane: 'UI_MOVE_PREVIOUS_PANE',
  UiOpenFile: 'UI_OPEN_FILE',
  UiOpenSsh: 'UI_OPEN_SSH',
  UiWindowMove: 'UI_WINDOW_MOVE',
  UiWindowGeometryUpdated: 'UI_WINDOW_GEOMETRY_UPDATED',
  UiEnterFullScreen: 'UI_ENTER_FULL_SCREEN',
  UiLeaveFullScreen: 'UI_LEAVE_FULL_SCREEN'
} as const;

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

const init = () => ({type: ActionType.InitAction});
const addNotificationMessage = ({text, url, dismissable}: AddNotificationParams) => ({
  type: ActionType.AddNotification,
  text,
  url,
  dismissable
});
const sessionActions = {
  addSession: (session: unknown) => ({type: ActionType.SessionAdd, session}),
  addSessionData: ({uid, data}: AddSessionDataParams) => ({type: ActionType.SessionData, uid, data}),
  sendSessionData: ({uid, data, escaped}: SendSessionDataParams) => ({
    type: ActionType.SessionDataSend,
    uid,
    data,
    ...(escaped !== undefined && {escaped})
  }),
  openSearch: () => ({type: ActionType.SessionSearch}),
  closeSearch: () => ({type: ActionType.SessionSearchClose}),
  clearActiveSession: () => ({type: ActionType.SessionClearActive}),
  ptyExitTermGroup: (uid: string) => ({type: ActionType.PtyExitTermGroup, uid}),
  userExitSession: (uid: string) => ({type: ActionType.UserExitSession, uid}),
  createExitAction: () => () => ({type: ActionType.CreateExitAction})
};
const termGroupActions = {
  requestTermGroup: ({activeUid, profile}: SplitRequestParams = {}) => ({
    type: ActionType.TermGroupRequest,
    activeUid,
    profile
  }),
  requestHorizontalSplit: ({activeUid, profile}: SplitRequestParams = {}) => ({
    type: ActionType.TermGroupSplitHoriz,
    activeUid,
    profile
  }),
  requestVerticalSplit: ({activeUid, profile}: SplitRequestParams = {}) => ({
    type: ActionType.TermGroupSplitVert,
    activeUid,
    profile
  }),
  exitActiveTermGroup: () => ({type: ActionType.TermGroupExitActive}),
  ptyExitTermGroup: (uid: string) => ({type: ActionType.PtyExitTermGroup, uid})
};
const uiActions = {
  setFontSmoothing: () => ({type: ActionType.UiSetFontSmoothing}),
  resetFontSize: () => ({type: ActionType.UiResetFontSize}),
  increaseFontSize: () => ({type: ActionType.UiIncreaseFontSize}),
  decreaseFontSize: () => ({type: ActionType.UiDecreaseFontSize}),
  moveLeft: () => ({type: ActionType.UiMoveLeft}),
  moveRight: () => ({type: ActionType.UiMoveRight}),
  moveTo: (index: number | 'last') => ({type: ActionType.UiMoveTo, index}),
  moveToNextPane: () => ({type: ActionType.UiMoveNextPane}),
  moveToPreviousPane: () => ({type: ActionType.UiMovePreviousPane}),
  openFile: (path: string) => ({type: ActionType.UiOpenFile, path}),
  openSSH: (parsedUrl: unknown) => ({type: ActionType.UiOpenSsh, parsedUrl}),
  windowGeometryUpdated: (data: {isMaximized: boolean}) => ({type: ActionType.UiWindowGeometryUpdated, data}),
  windowMove: (windowState: {bounds: {x: number; y: number}}) => ({type: ActionType.UiWindowMove, window: windowState}),
  enterFullScreen: () => ({type: ActionType.UiEnterFullScreen}),
  leaveFullScreen: () => ({type: ActionType.UiLeaveFullScreen})
};
const updaterActions = {
  updateAvailable: ({releaseName, notes, releaseUrl, canInstall}: UpdateAvailableParams) => ({
    type: ActionType.UpdateAvailable,
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
      loadConfig: mock((_config: unknown) => ({type: ActionType.LoadConfig})),
      reloadConfig: mock((_config: unknown) => ({type: ActionType.ReloadConfig})),
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
      TransportEvent.Ready,
      TransportEvent.SessionAdd,
      TransportEvent.SessionData,
      TransportEvent.SessionDataSend,
      TransportEvent.SessionExit,
      TransportEvent.SessionClearReq,
      TransportEvent.SessionMoveWordLeftReq,
      TransportEvent.SessionMoveWordRightReq,
      TransportEvent.SessionMoveLineBeginReq,
      TransportEvent.SessionMoveLineEndReq,
      TransportEvent.SessionDelWordLeftReq,
      TransportEvent.SessionDelWordRightReq,
      TransportEvent.SessionDelLineBeginReq,
      TransportEvent.SessionDelLineEndReq,
      TransportEvent.SessionBreakReq,
      TransportEvent.SessionStopReq,
      TransportEvent.SessionQuitReq,
      TransportEvent.SessionTmuxReq,
      TransportEvent.SessionSearch,
      TransportEvent.SessionSearchClose,
      TransportEvent.TermGroupCloseReq,
      TransportEvent.TermGroupAddReq,
      TransportEvent.SplitHorizontal,
      TransportEvent.SplitVertical,
      TransportEvent.ResetFontSizeReq,
      TransportEvent.IncreaseFontSizeReq,
      TransportEvent.DecreaseFontSizeReq,
      TransportEvent.MoveLeftReq,
      TransportEvent.MoveRightReq,
      TransportEvent.MoveJumpReq,
      TransportEvent.NextPaneReq,
      TransportEvent.PrevPaneReq,
      TransportEvent.OpenFile,
      TransportEvent.OpenSsh,
      TransportEvent.Move,
      TransportEvent.EnterFullScreen,
      TransportEvent.LeaveFullScreen,
      TransportEvent.WindowGeometryChange,
      TransportEvent.AddNotification,
      TransportEvent.UpdateAvailable,
      TransportEvent.Reload
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
    getListener(TransportEvent.Ready)(null);

    expect(dispatchMock.mock.calls).toContainEqual([{type: ActionType.InitAction}]);
    expect(dispatchMock.mock.calls).toContainEqual([{type: ActionType.UiSetFontSmoothing}]);
  });

  test('session add event dispatches SESSION_ADD actions', () => {
    clearDispatch();

    getListener(TransportEvent.SessionAdd)({
      uid: 's-1',
      shell: '/bin/bash',
      pid: 100,
      profile: 'default'
    } as unknown as Session);
    getListener(TransportEvent.SessionAdd)({
      uid: 's-2',
      shell: '/bin/bash',
      pid: 101,
      profile: 'default'
    } as unknown as Session);
    expect(dispatchMock.mock.calls).toContainEqual([
      {type: ActionType.SessionAdd, session: {uid: 's-1', shell: '/bin/bash', pid: 100, profile: 'default'}}
    ]);
    expect(dispatchMock.mock.calls).toContainEqual([
      {type: ActionType.SessionAdd, session: {uid: 's-2', shell: '/bin/bash', pid: 101, profile: 'default'}}
    ]);
    expect(dispatchMock.mock.calls.filter((call) => call[0]?.type === ActionType.SessionAdd)).toHaveLength(2);
  });

  test('session data event dispatches SESSION_DATA action', () => {
    clearDispatch();

    const uid = '01234567-89ab-cdef-0123-456789abcdef';
    getListener(TransportEvent.SessionData)(`${uid}hello world`);
    expect(dispatchMock.mock.calls).toContainEqual([{type: ActionType.SessionData, uid, data: 'hello world'}]);
  });

  test('session exit event dispatches PTY_EXIT_TERM_GROUP action', () => {
    clearDispatch();

    getListener(TransportEvent.SessionExit)({uid: 's-1'});
    expect(dispatchMock.mock.calls).toContainEqual([{type: ActionType.PtyExitTermGroup, uid: 's-1'}]);
  });

  test('reload invokes plugins.reload', () => {
    pluginsReloadMock.mockClear();
    getListener(TransportEvent.Reload)(null);
    expect(pluginsReloadMock).toHaveBeenCalledTimes(1);
  });

  test('update available dispatches UPDATE_AVAILABLE', () => {
    clearDispatch();
    getListener(TransportEvent.UpdateAvailable)({
      releaseName: 'v0.0.1',
      releaseNotes: 'notes',
      releaseUrl: 'https://example.org',
      canInstall: true
    });
    expect(dispatchMock.mock.calls).toContainEqual([
      {
        type: ActionType.UpdateAvailable,
        releaseName: 'v0.0.1',
        notes: 'notes',
        releaseUrl: 'https://example.org',
        canInstall: true
      }
    ]);
  });

  test('session data send dispatches SESSION_DATA_SEND with escaped flag', () => {
    clearDispatch();
    getListener(TransportEvent.SessionDataSend)({uid: 's-1', data: 'input', escaped: true});
    expect(dispatchMock.mock.calls).toContainEqual([
      {type: ActionType.SessionDataSend, uid: 's-1', data: 'input', escaped: true}
    ]);
  });

  test('session shortcut events dispatch sendSessionData with escape sequences', () => {
    clearDispatch();
    const cases: Array<{event: (typeof TransportEvent)[keyof typeof TransportEvent]; data: string}> = [
      {event: TransportEvent.SessionMoveWordLeftReq, data: '\x1bb'},
      {event: TransportEvent.SessionMoveWordRightReq, data: '\x1bf'},
      {event: TransportEvent.SessionMoveLineBeginReq, data: '\x1bOH'},
      {event: TransportEvent.SessionMoveLineEndReq, data: '\x1bOF'},
      {event: TransportEvent.SessionDelWordLeftReq, data: '\x1b\x7f'},
      {event: TransportEvent.SessionDelWordRightReq, data: '\x1bd'},
      {event: TransportEvent.SessionDelLineBeginReq, data: '\x1bw'},
      {event: TransportEvent.SessionDelLineEndReq, data: '\x10B'},
      {event: TransportEvent.SessionBreakReq, data: '\x03'},
      {event: TransportEvent.SessionStopReq, data: '\x1a'},
      {event: TransportEvent.SessionQuitReq, data: '\x1c'},
      {event: TransportEvent.SessionTmuxReq, data: '\x02'}
    ];
    for (const {event, data} of cases) {
      getListener(event)(null);
      expect(dispatchMock.mock.calls).toContainEqual([{type: ActionType.SessionDataSend, uid: null, data}]);
    }
  });

  test('parameterless events dispatch correct actions', () => {
    clearDispatch();
    const cases: Array<{
      event: (typeof TransportEvent)[keyof typeof TransportEvent];
      actionType: (typeof ActionType)[keyof typeof ActionType];
    }> = [
      {event: TransportEvent.SessionClearReq, actionType: ActionType.SessionClearActive},
      {event: TransportEvent.SessionSearch, actionType: ActionType.SessionSearch},
      {event: TransportEvent.SessionSearchClose, actionType: ActionType.SessionSearchClose},
      {event: TransportEvent.TermGroupCloseReq, actionType: ActionType.TermGroupExitActive},
      {event: TransportEvent.ResetFontSizeReq, actionType: ActionType.UiResetFontSize},
      {event: TransportEvent.IncreaseFontSizeReq, actionType: ActionType.UiIncreaseFontSize},
      {event: TransportEvent.DecreaseFontSizeReq, actionType: ActionType.UiDecreaseFontSize},
      {event: TransportEvent.MoveLeftReq, actionType: ActionType.UiMoveLeft},
      {event: TransportEvent.MoveRightReq, actionType: ActionType.UiMoveRight},
      {event: TransportEvent.NextPaneReq, actionType: ActionType.UiMoveNextPane},
      {event: TransportEvent.PrevPaneReq, actionType: ActionType.UiMovePreviousPane},
      {event: TransportEvent.EnterFullScreen, actionType: ActionType.UiEnterFullScreen},
      {event: TransportEvent.LeaveFullScreen, actionType: ActionType.UiLeaveFullScreen}
    ];
    for (const {event, actionType} of cases) {
      getListener(event)(null);
      expect(dispatchMock.mock.calls).toContainEqual([{type: actionType}]);
    }
  });

  test('payload-bearing events dispatch correct actions', () => {
    clearDispatch();

    getListener(TransportEvent.TermGroupAddReq)({activeUid: 's-1', profile: 'default'});
    expect(dispatchMock.mock.calls).toContainEqual([
      {type: ActionType.TermGroupRequest, activeUid: 's-1', profile: 'default'}
    ]);

    getListener(TransportEvent.SplitHorizontal)({activeUid: 's-1', profile: 'default'});
    expect(dispatchMock.mock.calls).toContainEqual([
      {type: ActionType.TermGroupSplitHoriz, activeUid: 's-1', profile: 'default'}
    ]);

    getListener(TransportEvent.SplitVertical)({activeUid: 's-1', profile: 'default'});
    expect(dispatchMock.mock.calls).toContainEqual([
      {type: ActionType.TermGroupSplitVert, activeUid: 's-1', profile: 'default'}
    ]);

    getListener(TransportEvent.MoveJumpReq)(3);
    expect(dispatchMock.mock.calls).toContainEqual([{type: ActionType.UiMoveTo, index: 3}]);

    getListener(TransportEvent.OpenFile)({path: '/tmp/test.txt'});
    expect(dispatchMock.mock.calls).toContainEqual([{type: ActionType.UiOpenFile, path: '/tmp/test.txt'}]);

    getListener(TransportEvent.AddNotification)({text: 'hello', url: 'https://example.org', dismissable: true});
    expect(dispatchMock.mock.calls).toContainEqual([
      {type: ActionType.AddNotification, text: 'hello', url: 'https://example.org', dismissable: true}
    ]);

    getListener(TransportEvent.Move)({bounds: {x: 100, y: 200}});
    expect(dispatchMock.mock.calls).toContainEqual([
      {type: ActionType.UiWindowMove, window: {bounds: {x: 100, y: 200}}}
    ]);

    getListener(TransportEvent.WindowGeometryChange)({isMaximized: false});
    expect(dispatchMock.mock.calls).toContainEqual([
      {type: ActionType.UiWindowGeometryUpdated, data: {isMaximized: false}}
    ]);
  });

  test('ordered bootstrap sequence: ready → session add → session data', () => {
    clearDispatch();

    getListener(TransportEvent.Ready)(null);
    getListener(TransportEvent.SessionAdd)({
      uid: 'seq-1',
      shell: '/bin/bash',
      pid: 200,
      profile: 'default'
    } as unknown as Session);
    const uid = '01234567-89ab-cdef-0123-456789abcdef';
    getListener(TransportEvent.SessionData)(`${uid}initial output`);
    getListener(TransportEvent.UpdateAvailable)({
      releaseName: 'v1.0.0',
      releaseNotes: 'release',
      releaseUrl: 'https://example.org',
      canInstall: false
    });

    const types = dispatchMock.mock.calls.map((call) => call[0]?.type as string);
    const initIdx = types.indexOf(ActionType.InitAction);
    const fontIdx = types.indexOf(ActionType.UiSetFontSmoothing);
    const addIdx = types.indexOf(ActionType.SessionAdd);
    const dataIdx = types.indexOf(ActionType.SessionData);
    const updateIdx = types.indexOf(ActionType.UpdateAvailable);

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
      getListener(TransportEvent.SessionData)(`${uid}chunk-${index}`);
    }

    const dataActions = dispatchMock.mock.calls.filter((call) => call[0]?.type === ActionType.SessionData);

    expect(dataActions).toHaveLength(count);

    for (let index = 0; index < count; index += 1) {
      expect(dataActions[index][0]).toEqual({
        type: ActionType.SessionData,
        uid,
        data: `chunk-${index}`
      });
    }
  });

  test('ready prerequisite: session add and data dispatch after ready', () => {
    clearDispatch();

    getListener(TransportEvent.Ready)(null);
    getListener(TransportEvent.SessionAdd)({
      uid: 'prereq-1',
      shell: '/bin/zsh',
      pid: 300,
      profile: 'default'
    } as unknown as Session);
    const uid = '01234567-89ab-cdef-0123-456789abcdef';
    getListener(TransportEvent.SessionData)(`${uid}post-ready output`);

    expect(dispatchMock.mock.calls).toContainEqual([{type: ActionType.InitAction}]);
    expect(dispatchMock.mock.calls).toContainEqual([
      {
        type: ActionType.SessionAdd,
        session: {uid: 'prereq-1', shell: '/bin/zsh', pid: 300, profile: 'default'}
      }
    ]);
    expect(dispatchMock.mock.calls).toContainEqual([{type: ActionType.SessionData, uid, data: 'post-ready output'}]);

    const types = dispatchMock.mock.calls.map((call) => call[0]?.type as string);
    const initIdx = types.indexOf(ActionType.InitAction);
    const addIdx = types.indexOf(ActionType.SessionAdd);
    const dataIdx = types.indexOf(ActionType.SessionData);
    expect(addIdx).toBeGreaterThan(initIdx);
    expect(dataIdx).toBeGreaterThan(initIdx);
  });
});
