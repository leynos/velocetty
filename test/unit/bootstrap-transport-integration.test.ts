/** @file Asserts bootstrap stream handlers use transport-on callbacks. */
import {afterAll, beforeAll, beforeEach, expect, mock, test} from 'bun:test';

import {setupHappyDom} from '../testUtils/happy-dom';

const shouldRunBootstrapTransportIntegration = process.env.VELOCETTY_RUN_BOOTSTRAP_TRANSPORT_INTEGRATION === '1';

if (!shouldRunBootstrapTransportIntegration) {
  test.skip('bootstrap event wiring delegates to transport event bus', () => {});
} else {
  const dispatchMock = mock((_action: unknown) => {});
  const transportOnCalls: Record<string, Array<(...args: unknown[]) => void>> = {};

  type Listener = (payload: unknown) => void;

  const transport = {
    invoke: mock(async () => ({})),
    emit: mock(() => true),
    off: mock((_event: string, _listener: Listener) => transport),
    once: mock((_event: string, _listener: Listener) => transport),
    removeAllListeners: mock(() => transport),
    destroy: mock(() => {}),
    on: mock((event: string, listener: Listener) => {
      transportOnCalls[event] = transportOnCalls[event] ? [...transportOnCalls[event], listener] : [listener];
      return transport;
    })
  };

  const getListener = (event: string): Listener => {
    const handlers = transportOnCalls[event];
    if (!handlers || handlers.length === 0) {
      throw new Error(`Expected transport listener for ${event}`);
    }
    return handlers[handlers.length - 1];
  };

  mock.module('../../lib/transport/electron-ipc-transport', () => ({transport}));
  mock.module('electron', () => ({
    webFrame: {setZoomFactor: mock(() => {})},
    ipcRenderer: {
      invoke: mock(async () => ({})),
      on: mock(() => {}),
      send: mock(() => {}),
      removeAllListeners: mock(() => {}),
      removeListener: mock(() => {})
    }
  }));
  mock.module('react-dom/client', () => ({
    createRoot: () => ({
      render: mock(() => {}),
      unmount: mock(() => {})
    })
  }));
  mock.module('../../lib/store/configure-store', () => ({
    default: () => ({
      dispatch: dispatchMock,
      getState: () => ({
        ui: {bellSoundURL: 'sound.wav', bellSound: 'abc', bell: 'SOUND'},
        sessions: {activeUid: 'session-0', sessions: {}},
        termGroups: {termGroups: {}, activeSessions: {}, activeRootGroup: null}
      })
    })
  }));
  mock.module('../../lib/actions/config', () => ({
    loadConfig: (config: unknown) => ({type: 'LOAD_CONFIG', config}),
    reloadConfig: (config: unknown) => ({type: 'RELOAD_CONFIG', config})
  }));
  mock.module('../../lib/actions/index', () => ({default: () => ({type: 'INIT_ACTION'})}));
  mock.module('../../lib/actions/notifications', () => ({
    addNotificationMessage: (text: string, url: string | null, dismissable: boolean) => ({
      type: 'ADD_NOTIFICATION',
      text,
      url,
      dismissable
    })
  }));
  mock.module('../../lib/actions/sessions', () => ({
    addSession: (session: unknown) => ({type: 'SESSION_ADD', session}),
    addSessionData: (uid: string, data: string) => ({type: 'SESSION_DATA', uid, data}),
    sendSessionData: (uid: string, data: string) => ({type: 'SESSION_DATA_SEND', uid, data}),
    openSearch: () => ({type: 'SESSION_SEARCH'}),
    closeSearch: () => ({type: 'SESSION_SEARCH_CLOSE'}),
    clearActiveSession: () => ({type: 'SESSION_CLEAR_ACTIVE'}),
    ptyExitTermGroup: (uid: string) => ({type: 'PTY_EXIT_TERM_GROUP', uid}),
    userExitSession: (uid: string) => ({type: 'USER_EXIT_SESSION', uid}),
    createExitAction: () => () => ({type: 'CREATE_EXIT_ACTION'})
  }));
  mock.module('../../lib/actions/term-groups', () => ({
    requestTermGroup: (_activeUid?: string, profile?: string) => ({
      type: 'TERM_GROUP_REQUEST',
      activeUid: _activeUid,
      profile
    }),
    requestHorizontalSplit: (_activeUid?: string, profile?: string) => ({
      type: 'TERM_GROUP_SPLIT_HORIZONTAL',
      activeUid: _activeUid,
      profile
    }),
    requestVerticalSplit: (_activeUid?: string, profile?: string) => ({
      type: 'TERM_GROUP_SPLIT_VERTICAL',
      activeUid: _activeUid,
      profile
    }),
    exitActiveTermGroup: () => ({type: 'TERM_GROUP_EXIT_ACTIVE'}),
    ptyExitTermGroup: (uid: string) => ({type: 'PTY_EXIT_TERM_GROUP', uid})
  }));
  mock.module('../../lib/actions/ui', () => {
    const actions = {
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
      openSSH: (parsedUrl: ReturnType<typeof URL> | unknown) => ({type: 'UI_OPEN_SSH', parsedUrl}),
      windowGeometryUpdated: (data: {isMaximized: boolean}) => ({type: 'UI_WINDOW_GEOMETRY_UPDATED', data}),
      windowMove: (window: {bounds: {x: number; y: number}}) => ({type: 'UI_WINDOW_MOVE', window}),
      enterFullScreen: () => ({type: 'UI_ENTER_FULL_SCREEN'}),
      leaveFullScreen: () => ({type: 'UI_LEAVE_FULL_SCREEN'})
    };
    return {
      __esModule: true,
      default: actions,
      ...actions
    };
  });
  mock.module('../../lib/actions/updater', () => ({
    updateAvailable: (releaseName: string, notes: string, releaseUrl: string, canInstall: boolean) => ({
      type: 'UPDATE_AVAILABLE',
      releaseName,
      notes,
      releaseUrl,
      canInstall
    })
  }));
  mock.module('../../lib/utils/file', () => ({
    getBase64FileData: async () => 'ZGF0YQ=='
  }));
  mock.module('../../lib/utils/config', () => ({
    getConfig: () => ({
      bell: 'SOUND',
      bellSound: 'sound',
      bellSoundURL: 'sound.wav'
    }),
    subscribe: () => {}
  }));
  mock.module('../../lib/containers/hyper', () => ({default: () => null}));
  const pluginsReloadMock = mock(() => {});
  mock.module('../../lib/utils/plugins', () => ({
    connect: () => (Component: unknown) => Component,
    default: {},
    reload: pluginsReloadMock
  }));

  let importCounter = 0;
  let cleanupHappyDom: (() => void) | null = null;

  beforeAll(async () => {
    cleanupHappyDom = await setupHappyDom();
  });

  afterAll(() => {
    cleanupHappyDom?.();
    cleanupHappyDom = null;
    mock.restore();
  });

  beforeEach(() => {
    importCounter += 1;
    dispatchMock.mockClear();
    transport.invoke.mockClear();
    transport.emit.mockClear();
    transport.off.mockClear();
    transport.once.mockClear();
    transport.removeAllListeners.mockClear();
    transport.destroy.mockClear();
    transport.on.mockClear();
    pluginsReloadMock.mockClear();
    Object.keys(transportOnCalls).forEach((key) => {
      transportOnCalls[key].length = 0;
    });
  });

  test('bootstrap event wiring delegates to transport event bus', async () => {
    await import(`../../lib/index.tsx?transport_integration=${importCounter}`);

    expect(transport.on.mock.calls).toEqual(
      expect.arrayContaining([
        ['ready', expect.any(Function)],
        ['session add', expect.any(Function)],
        ['session data', expect.any(Function)],
        ['reload', expect.any(Function)],
        ['move left req', expect.any(Function)],
        ['windowGeometry change', expect.any(Function)],
        ['update available', expect.any(Function)]
      ])
    );

    const readyListener = getListener('ready');
    readyListener(null);

    expect(dispatchMock.mock.calls).toContainEqual([{type: 'INIT_ACTION'}]);
    expect(dispatchMock.mock.calls).toContainEqual([{type: 'UI_SET_FONT_SMOOTHING'}]);

    const sessionListener = getListener('session add');
    sessionListener({uid: 'session-1', shell: '/bin/bash', pid: 100, profile: 'default'} as never);
    sessionListener({uid: 'session-2', shell: '/bin/bash', pid: 101, profile: 'default'} as never);

    const updateListener = getListener('update available');
    updateListener({
      releaseName: 'v0.0.1',
      releaseNotes: 'notes',
      releaseUrl: 'https://example.org',
      canInstall: true
    });

    expect(dispatchMock.mock.calls).toContainEqual([
      {
        type: 'SESSION_ADD',
        session: {uid: 'session-1', shell: '/bin/bash', pid: 100, profile: 'default'}
      }
    ]);
    expect(dispatchMock.mock.calls).toContainEqual([
      {
        type: 'SESSION_ADD',
        session: {uid: 'session-2', shell: '/bin/bash', pid: 101, profile: 'default'}
      }
    ]);
    expect(dispatchMock.mock.calls).toContainEqual([
      {
        type: 'UPDATE_AVAILABLE',
        releaseName: 'v0.0.1',
        notes: 'notes',
        releaseUrl: 'https://example.org',
        canInstall: true
      }
    ]);

    const sessionAddDispatches = dispatchMock.mock.calls.filter((call) => call[0]?.type === 'SESSION_ADD');
    expect(sessionAddDispatches).toHaveLength(2);

    // session data: uid is a 36-char prefix, remainder is payload
    const sessionDataListener = getListener('session data');
    const uid = '01234567-89ab-cdef-0123-456789abcdef';
    sessionDataListener(`${uid}hello world`);
    expect(dispatchMock.mock.calls).toContainEqual([{type: 'SESSION_DATA', uid, data: 'hello world'}]);

    // reload: invokes plugins.reload
    const reloadListener = getListener('reload');
    reloadListener(null);
    expect(pluginsReloadMock).toHaveBeenCalledTimes(1);

    // move left req: dispatches UI_MOVE_LEFT
    const moveLeftListener = getListener('move left req');
    moveLeftListener(null);
    expect(dispatchMock.mock.calls).toContainEqual([{type: 'UI_MOVE_LEFT'}]);

    // windowGeometry change: dispatches UI_WINDOW_GEOMETRY_UPDATED
    const geometryListener = getListener('windowGeometry change');
    const geometryPayload = {isMaximized: false};
    geometryListener(geometryPayload);
    expect(dispatchMock.mock.calls).toContainEqual([{type: 'UI_WINDOW_GEOMETRY_UPDATED', data: geometryPayload}]);
  });
}
