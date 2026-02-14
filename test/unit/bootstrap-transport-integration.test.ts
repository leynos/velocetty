/** @file Asserts bootstrap stream handlers use transport-on callbacks. */
import {afterAll, beforeAll, describe, expect, mock, test} from 'bun:test';

import type {Session} from '@shared/types/common';

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
    removeAllListeners: mock((_event?: string) => transport),
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
    sendSessionData: (uid: string | null, data: string, escaped?: boolean) => ({
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
      openSSH: (parsedUrl: unknown) => ({type: 'UI_OPEN_SSH', parsedUrl}),
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

  /**
   * Import the bootstrap module and return a helper that invokes
   * registered listeners by event name.
   */
  const importBootstrap = async () => {
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
      transportOnCalls[key] = [];
    });
    await import(`../../lib/index.tsx?transport_integration=${importCounter}`);
  };

  describe('bootstrap transport event wiring', () => {
    beforeAll(async () => {
      await importBootstrap();
    });

    const clearDispatch = () => dispatchMock.mockClear();

    test('registers all expected transport listeners', () => {
      const expectedEvents = [
        // bootstrap lifecycle
        'ready',

        // session lifecycle and data
        'session add',
        'session data',
        'session data send',
        'session exit',
        'session clear req',

        // session navigation / word and line shortcuts
        'session move word left req',
        'session move word right req',
        'session move line beginning req',
        'session move line end req',

        // session deletion shortcuts
        'session del word left req',
        'session del word right req',
        'session del line beginning req',
        'session del line end req',

        // session control shortcuts
        'session break req',
        'session stop req',
        'session quit req',
        'session tmux req',

        // session search
        'session search',
        'session search close',

        // termgroup control
        'termgroup close req',
        'termgroup add req',
        'split request horizontal',
        'split request vertical',

        // font size
        'reset fontSize req',
        'increase fontSize req',
        'decrease fontSize req',

        // tab and pane navigation
        'move left req',
        'move right req',
        'move jump req',
        'next pane req',
        'prev pane req',

        // file and SSH
        'open file',
        'open ssh',

        // window
        'move',
        'enter full screen',
        'leave full screen',
        'windowGeometry change',

        // notifications and updates
        'add notification',
        'update available',

        // plugin reload
        'reload'
      ];

      const registeredEvents = transport.on.mock.calls.map(([name]: [string]) => name);

      // Exact count guards against missing or extra listeners
      expect(registeredEvents).toHaveLength(expectedEvents.length);

      // Sorted set equality catches renames, additions, and removals
      expect([...registeredEvents].sort()).toEqual([...expectedEvents].sort());

      // Each listener must be a function
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
      expect(dispatchMock.mock.calls.filter((c) => c[0]?.type === 'SESSION_ADD')).toHaveLength(2);
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
      expect(dispatchMock.mock.calls).toContainEqual([
        {type: 'UI_WINDOW_GEOMETRY_UPDATED', data: {isMaximized: false}}
      ]);
    });
  });
}
