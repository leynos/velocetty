/**
 * @file Asserts bootstrap stream handlers wire transport-on callbacks.
 *
 * Exercises `registerTransportListeners` from
 * `lib/bootstrap/renderer-bootstrap.ts` with in-test transport, store,
 * plugins, and action-creator doubles supplied by
 * `test/testUtils/bootstrap-transport-fixture.ts`.
 *
 * Invariants: listener registration order is deterministic; the doubles are
 * reset before each test via `resetFixture`; the returned cleanup removes
 * every registered listener with one-to-one `on`/`off` correspondence; and
 * each event forwards its payload to the creator the production handler names.
 *
 * @see lib/bootstrap/renderer-bootstrap.ts
 */
import {beforeEach, describe, expect, spyOn, test} from 'bun:test';

import {asProfileId, asSessionId, type Session} from '@shared/types/common';
import {NOTIFICATION_MESSAGE} from '@shared/constants/notifications';
import {
  createBootstrapActions,
  dispatchMock,
  getListener,
  getPluginReloadCount,
  plugins,
  recordedCalls,
  resetFixture,
  store,
  transport,
  transportOnCalls,
  type Listener
} from '../testUtils/bootstrap-transport-fixture';
import {registerTransportListeners} from '../../lib/bootstrap/renderer-bootstrap';

const createMockSession = (overrides: Partial<Omit<Session, 'uid'>> & {uid: string}): Session => {
  const {uid, ...sessionOverrides} = overrides;
  return {
    shell: '/bin/bash',
    pid: 0,
    profile: asProfileId('default'),
    ...sessionOverrides,
    uid: asSessionId(uid)
  };
};

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

const registerBootstrapTransportListeners = () => {
  resetFixture();

  return registerTransportListeners({
    actions: createBootstrapActions(),
    plugins,
    store,
    transport
  });
};

/** Clears the dispatch double and the recorded creator invocations together. */
const clearDispatch = () => {
  dispatchMock.mockClear();
  recordedCalls.length = 0;
};

describe('bootstrap transport event wiring', () => {
  beforeEach(() => {
    registerBootstrapTransportListeners();
  });

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

    const registeredEvents = transport.on.mock.calls.map(([name]: [string, ...unknown[]]) => name);

    expect(registeredEvents).toHaveLength(expectedEvents.length);
    expect([...registeredEvents].toSorted()).toEqual([...expectedEvents].toSorted());

    for (const event of expectedEvents) {
      expect(transport.on.mock.calls).toContainEqual([event, expect.any(Function)]);
    }
  });

  test('cleanup removes every registered transport listener', () => {
    resetFixture();

    const cleanup = registerTransportListeners({
      actions: createBootstrapActions(),
      plugins,
      store,
      transport
    });
    const registeredPairs = transport.on.mock.calls.map(
      ([event, listener]: [string, Listener]) => [event, listener] as const
    );

    expect(registeredPairs.length).toBeGreaterThan(0);

    cleanup();

    expect(transport.off.mock.calls).toHaveLength(registeredPairs.length);
    for (const [event, listener] of registeredPairs) {
      expect(transport.off.mock.calls).toContainEqual([event, listener]);
    }
    expect(Object.values(transportOnCalls).flat()).toHaveLength(0);
  });

  test('registration failure removes listeners registered before the throw', () => {
    resetFixture();

    const registrationError = new Error('transport.on failed mid-registration');
    const failingCallNumber = 5;
    const successfulRegistrations: Array<[string, Listener]> = [];
    let callCount = 0;
    transport.on.mockImplementation((event: string, listener: Listener) => {
      callCount += 1;
      successfulRegistrations.push([event, listener]);
      transportOnCalls[event] = transportOnCalls[event] ? [...transportOnCalls[event], listener] : [listener];
      if (callCount === failingCallNumber) {
        throw registrationError;
      }
      return transport;
    });

    expect(() =>
      registerTransportListeners({
        actions: createBootstrapActions(),
        plugins,
        store,
        transport
      })
    ).toThrow(registrationError);

    expect(successfulRegistrations).toHaveLength(failingCallNumber);
    expect(transport.off.mock.calls).toHaveLength(failingCallNumber);
    expect(transport.off.mock.calls).toEqual([...successfulRegistrations].toReversed());

    for (const [event, listener] of successfulRegistrations) {
      expect(transport.off.mock.calls).toContainEqual([event, listener]);
    }

    expect(Object.values(transportOnCalls).flat()).toHaveLength(0);
  });

  test('registration failure preserves the original error when rollback cleanup also throws', () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      resetFixture();

      const registrationError = new Error('transport.on failed mid-registration');
      const rollbackError = new Error('transport.off failed during rollback');
      const failingCallNumber = 4;
      let callCount = 0;
      transport.on.mockImplementation((event: string, listener: Listener) => {
        callCount += 1;
        transportOnCalls[event] = transportOnCalls[event] ? [...transportOnCalls[event], listener] : [listener];
        if (callCount === failingCallNumber) {
          throw registrationError;
        }
        return transport;
      });
      transport.off.mockImplementationOnce((_event: string, _listener: Listener) => {
        throw rollbackError;
      });

      expect(() =>
        registerTransportListeners({
          actions: createBootstrapActions(),
          plugins,
          store,
          transport
        })
      ).toThrow(registrationError);

      expect(transport.off.mock.calls).toHaveLength(failingCallNumber);
      expect(errorSpy).toHaveBeenCalledWith(
        'Renderer bootstrap cleanup failed during transport listener removal (rollback).',
        rollbackError
      );
      expect(errorSpy).toHaveBeenCalledWith(
        'Renderer transport listener registration rollback encountered 1 cleanup error(s).'
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('ready dispatches init and font smoothing', () => {
    clearDispatch();
    getListener(TransportEvent.Ready)(null);

    expect(recordedCalls.map(({creator}) => creator)).toEqual(['init', 'setFontSmoothing']);
  });

  test('session add event dispatches SESSION_ADD actions', () => {
    clearDispatch();

    getListener(TransportEvent.SessionAdd)(createMockSession({uid: 's-1', pid: 100}));
    getListener(TransportEvent.SessionAdd)(createMockSession({uid: 's-2', pid: 101}));

    const sessionAdds = recordedCalls.filter(({creator}) => creator === 'addSession');
    expect(sessionAdds).toHaveLength(2);
    expect(sessionAdds.map(({args}) => args[0])).toEqual([
      {uid: 's-1', shell: '/bin/bash', pid: 100, profile: 'default'},
      {uid: 's-2', shell: '/bin/bash', pid: 101, profile: 'default'}
    ]);
  });

  test('session data event splits the uid prefix from the payload', () => {
    clearDispatch();

    const uid = '01234567-89ab-cdef-0123-456789abcdef';
    getListener(TransportEvent.SessionData)(`${uid}hello world`);

    expect(recordedCalls).toContainEqual({creator: 'addSessionData', args: [{uid, data: 'hello world'}]});
  });

  test('session exit event dispatches PTY_EXIT_TERM_GROUP action', () => {
    clearDispatch();

    getListener(TransportEvent.SessionExit)({uid: 's-1'});
    expect(recordedCalls).toContainEqual({creator: 'ptyExitTermGroup', args: ['s-1']});
  });

  test('reload invokes plugins.reload', () => {
    getListener(TransportEvent.Reload)(null);
    expect(getPluginReloadCount()).toBe(1);
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
        type: 'UPDATE_AVAILABLE',
        version: 'v0.0.1',
        notes: 'notes',
        releaseUrl: 'https://example.org',
        canInstall: true
      }
    ]);
  });

  test('session data send forwards the escaped flag', () => {
    clearDispatch();
    getListener(TransportEvent.SessionDataSend)({uid: 's-1', data: 'input', escaped: true});
    expect(recordedCalls).toContainEqual({
      creator: 'sendSessionData',
      args: [{uid: 's-1', data: 'input', escaped: true}]
    });
  });

  test('session shortcut events dispatch sendSessionData with escape sequences', () => {
    clearDispatch();
    const cases: Array<{event: (typeof TransportEvent)[keyof typeof TransportEvent]; data: string}> = [
      {event: TransportEvent.SessionMoveWordLeftReq, data: '\x1Bb'},
      {event: TransportEvent.SessionMoveWordRightReq, data: '\x1Bf'},
      {event: TransportEvent.SessionMoveLineBeginReq, data: '\x1BOH'},
      {event: TransportEvent.SessionMoveLineEndReq, data: '\x1BOF'},
      {event: TransportEvent.SessionDelWordLeftReq, data: '\x1B\x7F'},
      {event: TransportEvent.SessionDelWordRightReq, data: '\x1Bd'},
      {event: TransportEvent.SessionDelLineBeginReq, data: '\x1Bw'},
      {event: TransportEvent.SessionDelLineEndReq, data: '\x10B'},
      {event: TransportEvent.SessionBreakReq, data: '\x03'},
      {event: TransportEvent.SessionStopReq, data: '\x1A'},
      {event: TransportEvent.SessionQuitReq, data: '\x1C'},
      {event: TransportEvent.SessionTmuxReq, data: '\x02'}
    ];
    for (const {event, data} of cases) {
      getListener(event)(null);
      expect(recordedCalls).toContainEqual({creator: 'sendSessionData', args: [{uid: null, data}]});
    }
  });

  test('parameterless events dispatch the creator each event names', () => {
    clearDispatch();
    const cases: Array<{
      event: (typeof TransportEvent)[keyof typeof TransportEvent];
      creator: string;
    }> = [
      {event: TransportEvent.SessionClearReq, creator: 'clearActiveSession'},
      {event: TransportEvent.SessionSearch, creator: 'openSearch'},
      {event: TransportEvent.SessionSearchClose, creator: 'closeSearch'},
      {event: TransportEvent.TermGroupCloseReq, creator: 'exitActiveTermGroup'},
      {event: TransportEvent.ResetFontSizeReq, creator: 'resetFontSize'},
      {event: TransportEvent.IncreaseFontSizeReq, creator: 'increaseFontSize'},
      {event: TransportEvent.DecreaseFontSizeReq, creator: 'decreaseFontSize'},
      {event: TransportEvent.MoveLeftReq, creator: 'moveLeft'},
      {event: TransportEvent.MoveRightReq, creator: 'moveRight'},
      {event: TransportEvent.NextPaneReq, creator: 'moveToNextPane'},
      {event: TransportEvent.PrevPaneReq, creator: 'moveToPreviousPane'},
      {event: TransportEvent.EnterFullScreen, creator: 'enterFullScreen'},
      {event: TransportEvent.LeaveFullScreen, creator: 'leaveFullScreen'}
    ];
    for (const {event, creator} of cases) {
      clearDispatch();
      getListener(event)(null);
      expect(recordedCalls.map((recorded) => recorded.creator)).toEqual([creator]);
    }
  });

  test('payload-bearing events forward their payloads', () => {
    clearDispatch();

    getListener(TransportEvent.TermGroupAddReq)({activeUid: 's-1', profile: 'default'});
    expect(recordedCalls).toContainEqual({
      creator: 'requestTermGroup',
      args: [{activeUid: 's-1', profile: 'default'}]
    });

    getListener(TransportEvent.SplitHorizontal)({activeUid: 's-1', profile: 'default'});
    expect(recordedCalls).toContainEqual({
      creator: 'requestHorizontalSplit',
      args: [{activeUid: 's-1', profile: 'default'}]
    });

    getListener(TransportEvent.SplitVertical)({activeUid: 's-1', profile: 'default'});
    expect(recordedCalls).toContainEqual({
      creator: 'requestVerticalSplit',
      args: [{activeUid: 's-1', profile: 'default'}]
    });

    getListener(TransportEvent.MoveJumpReq)(3);
    expect(recordedCalls).toContainEqual({creator: 'moveTo', args: [3]});

    getListener(TransportEvent.OpenFile)({path: '/tmp/test.txt'});
    expect(recordedCalls).toContainEqual({creator: 'openFile', args: ['/tmp/test.txt']});

    getListener(TransportEvent.AddNotification)({text: 'hello', url: 'https://example.org', dismissable: true});
    expect(dispatchMock.mock.calls).toContainEqual([
      {type: NOTIFICATION_MESSAGE, text: 'hello', url: 'https://example.org', dismissable: true}
    ]);

    getListener(TransportEvent.Move)({bounds: {x: 100, y: 200}});
    expect(recordedCalls).toContainEqual({creator: 'windowMove', args: [{bounds: {x: 100, y: 200}}]});

    getListener(TransportEvent.WindowGeometryChange)({isMaximized: false});
    expect(dispatchMock.mock.calls).toContainEqual([{type: 'UI_WINDOW_GEOMETRY_CHANGED', isMaximized: false}]);
  });

  test('ordered bootstrap sequence: ready → session add → session data', () => {
    clearDispatch();

    getListener(TransportEvent.Ready)(null);
    getListener(TransportEvent.SessionAdd)(createMockSession({uid: 'seq-1', pid: 200}));
    const uid = '01234567-89ab-cdef-0123-456789abcdef';
    getListener(TransportEvent.SessionData)(`${uid}initial output`);
    getListener(TransportEvent.UpdateAvailable)({
      releaseName: 'v1.0.0',
      releaseNotes: 'release',
      releaseUrl: 'https://example.org',
      canInstall: false
    });

    const creators = recordedCalls.map((recorded) => recorded.creator);
    const initIdx = creators.indexOf('init');
    const fontIdx = creators.indexOf('setFontSmoothing');
    const addIdx = creators.indexOf('addSession');
    const dataIdx = creators.indexOf('addSessionData');
    const updateIdx = creators.indexOf('updateAvailable');

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

    const dataCalls = recordedCalls.filter(({creator}) => creator === 'addSessionData');

    expect(dataCalls).toHaveLength(count);

    for (let index = 0; index < count; index += 1) {
      expect(dataCalls[index].args).toEqual([{uid, data: `chunk-${index}`}]);
    }
  });

  test('ready prerequisite: session add and data dispatch after ready', () => {
    clearDispatch();

    getListener(TransportEvent.Ready)(null);
    getListener(TransportEvent.SessionAdd)(createMockSession({uid: 'prereq-1', shell: '/bin/zsh', pid: 300}));
    const uid = '01234567-89ab-cdef-0123-456789abcdef';
    getListener(TransportEvent.SessionData)(`${uid}post-ready output`);

    expect(recordedCalls.map(({creator}) => creator)).toEqual([
      'init',
      'setFontSmoothing',
      'addSession',
      'addSessionData'
    ]);
    expect(recordedCalls).toContainEqual({
      creator: 'addSession',
      args: [{uid: 'prereq-1', shell: '/bin/zsh', pid: 300, profile: 'default'}]
    });
    expect(recordedCalls).toContainEqual({creator: 'addSessionData', args: [{uid, data: 'post-ready output'}]});

    const creators = recordedCalls.map((recorded) => recorded.creator);
    const initIdx = creators.indexOf('init');
    expect(creators.indexOf('addSession')).toBeGreaterThan(initIdx);
    expect(creators.indexOf('addSessionData')).toBeGreaterThan(initIdx);
  });
});
