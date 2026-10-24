/**
 * @file Test doubles for the renderer bootstrap transport wiring.
 *
 * `lib/bootstrap/renderer-bootstrap.ts` accepts its action modules, store and
 * transport as dependencies, so the wiring can be exercised without Electron.
 * These doubles keep two properties that earlier hand-rolled fixtures lost:
 *
 * 1. Action *types* come from `@shared/constants/*`, never from a local copy.
 *    A parallel vocabulary silently agreed with itself while disagreeing with
 *    the reducers, so no test could notice a wrong constant.
 * 2. Each creator is either a plain action or a thunk exactly as the real
 *    creator is. `BootstrapActionModules` is derived from the production
 *    modules, so a creator that changes shape breaks the double here.
 *
 * Calls are recorded as well as dispatched, because production carries most
 * payloads in `effect` closures rather than in the action object. The record
 * is what lets a test see the arguments the handler forwarded.
 *
 * Cross-link: `lib/bootstrap/renderer-bootstrap.ts`.
 */
import {mock} from 'bun:test';

import {INIT} from '@shared/constants';
import {CONFIG_LOAD, CONFIG_RELOAD} from '@shared/constants/config';
import type {configOptions} from '@shared/types/config';
import {NOTIFICATION_MESSAGE} from '@shared/constants/notifications';
import {
  SESSION_ADD,
  SESSION_ADD_DATA,
  SESSION_CLEAR_ACTIVE,
  SESSION_PTY_EXIT,
  SESSION_REQUEST,
  SESSION_SEARCH,
  SESSION_USER_DATA
} from '@shared/constants/sessions';
import {TERM_GROUP_EXIT_ACTIVE, TERM_GROUP_REQUEST} from '@shared/constants/term-groups';
import {
  UI_ENTER_FULLSCREEN,
  UI_FONT_SIZE_DECR,
  UI_FONT_SIZE_INCR,
  UI_FONT_SIZE_RESET,
  UI_FONT_SMOOTHING_SET,
  UI_LEAVE_FULLSCREEN,
  UI_MOVE_LEFT,
  UI_MOVE_NEXT_PANE,
  UI_MOVE_PREV_PANE,
  UI_MOVE_RIGHT,
  UI_MOVE_TO,
  UI_OPEN_FILE,
  UI_OPEN_SSH_URL,
  UI_WINDOW_GEOMETRY_CHANGED,
  UI_WINDOW_MOVE
} from '@shared/constants/ui';
import {UPDATE_AVAILABLE} from '@shared/constants/updater';
import {asSessionId, type Session} from '@shared/types/common';
import {isFunction} from '@shared/types/guards';
import type {AddNotificationParams, UpdateAvailableParams} from '../../lib/bootstrap/renderer-bootstrap';
import type {HyperActions, HyperDispatch} from '../../typings/hyper';

export type Listener = (payload: unknown) => void;

/** One creator invocation, recorded so payload forwarding stays observable. */
export type RecordedCall = {creator: string; args: unknown[]};

/**
 * The store slice this fixture hands to a thunk.
 *
 * Named from the single factory below rather than written twice, so the thunk
 * contract and the double's `getState` cannot drift apart.
 */
type FixtureState = ReturnType<typeof createFixtureState>;

/**
 * Builds the state the store double reports.
 *
 * The values are fixed for the same reason `now` is: the fixture's job is to
 * show which creator ran, and a changing state would only add noise.
 */
const createFixtureState = () => ({
  ui: {bellSoundURL: 'sound.wav', bellSound: 'abc', bell: 'SOUND'},
  sessions: {activeUid: 'session-0', sessions: {}},
  termGroups: {termGroups: {}, activeSessions: {}, activeRootGroup: null}
});

type Thunk = (dispatch: (action: unknown) => void, getState: () => FixtureState) => void;

const isThunk = (value: unknown): value is Thunk => isFunction(value);

/** Dispatched actions, minus the ones that arrived as thunks. */
export const dispatchMock = mock((_action: unknown) => {});

/** Listeners registered through the transport double, keyed by event name. */
export const transportOnCalls: Partial<Record<string, Listener[]>> = {};

export const recordedCalls: RecordedCall[] = [];

let pluginReloadCount = 0;

/**
 * Dispatch double that runs thunks the way the store's middleware does.
 *
 * A bare recorder would store the thunk itself and the assertions about
 * emitted actions would never see what it dispatches.
 */
const dispatchThrough = (action: unknown): void => {
  if (isThunk(action)) {
    // The thunk reads the same state a caller of `store.getState` would see,
    // rather than a placeholder that would fail the moment a thunk inspected it.
    action(dispatchThrough, createFixtureState);
    return;
  }

  dispatchMock(action);
};

const registerTransportListener = (event: string, listener: Listener) => {
  transportOnCalls[event] = transportOnCalls[event] ? [...transportOnCalls[event], listener] : [listener];
  return transport;
};

export const transport = {
  // `registerTransportListeners` only subscribes and unsubscribes, so an invoke
  // reaching this double means the code under test changed shape. Throwing keeps
  // that visible instead of answering with a placeholder that hides it.
  invoke: mock((): never => {
    throw new Error('Unexpected transport.invoke call in transport-listener tests.');
  }),
  emit: mock(() => true),
  off: mock((event: string, listener: Listener) => {
    const handlers = transportOnCalls[event];
    if (!handlers) {
      return transport;
    }

    const remainingHandlers = handlers.filter((registeredListener) => registeredListener !== listener);
    if (remainingHandlers.length === 0) {
      delete transportOnCalls[event];
    } else {
      transportOnCalls[event] = remainingHandlers;
    }

    return transport;
  }),
  once: mock((_event: string, _listener: Listener) => transport),
  removeAllListeners: mock((event?: string) => {
    if (event) {
      delete transportOnCalls[event];
      return transport;
    }

    Object.keys(transportOnCalls).forEach((key) => {
      delete transportOnCalls[key];
    });

    return transport;
  }),
  destroy: mock(() => {}),
  on: mock(registerTransportListener)
};

export const store = {
  dispatch: dispatchThrough,
  getState: createFixtureState
};

export const plugins = {
  reload: () => {
    pluginReloadCount += 1;
  }
};

export const getPluginReloadCount = () => pluginReloadCount;

const record = (creator: string, args: unknown[]): void => {
  recordedCalls.push({creator, args});
};

/**
 * Builds a thunk creator, recording its arguments before dispatching.
 *
 * The dispatched action is the smallest value the real contract admits: most
 * production creators carry their payload in an `effect` closure, so the
 * record above — not the action object — is what proves forwarding.
 */
const thunk =
  <TArgs extends unknown[], TAction extends HyperActions>(creator: string, build: (...args: TArgs) => TAction) =>
  (...args: TArgs) =>
  // No return annotation: `ptyExitTermGroup` returns the exit action it
  // dispatches, and the production signature names that narrower type.
  (dispatch: HyperDispatch) => {
    record(creator, args);
    return dispatch(build(...args));
  };

/**
 * Builds a plain action creator, recording its arguments as it returns.
 *
 * Recording here too keeps `recordedCalls` a uniform view of every creator the
 * wiring chose, whether or not the real creator returns a thunk.
 */
const action =
  <TArgs extends unknown[], TAction extends HyperActions>(creator: string, build: (...args: TArgs) => TAction) =>
  (...args: TArgs): TAction => {
    record(creator, args);
    return build(...args);
  };

const sessionActions = {
  addSession: thunk(
    'addSession',
    (session: Session): HyperActions => ({
      type: SESSION_ADD,
      uid: session.uid,
      shell: session.shell,
      pid: session.pid,
      cols: session.cols ?? null,
      rows: session.rows ?? null,
      splitDirection: session.splitDirection,
      activeUid: session.activeUid ?? null,
      // Fixed rather than `Date.now()`: the fixture's job is to show that the
      // action reached the store, and a clock reading would only add noise.
      now: 0,
      profile: session.profile
    })
  ),
  addSessionData: thunk('addSessionData', () => ({type: SESSION_ADD_DATA})),
  sendSessionData: thunk('sendSessionData', () => ({type: SESSION_USER_DATA})),
  openSearch: thunk('openSearch', () => ({type: SESSION_SEARCH, uid: asSessionId('session-0'), value: true})),
  closeSearch: thunk('closeSearch', () => ({type: SESSION_SEARCH, uid: asSessionId('session-0'), value: false})),
  clearActiveSession: action('clearActiveSession', () => ({type: SESSION_CLEAR_ACTIVE}))
};

const termGroupActions = {
  requestTermGroup: thunk('requestTermGroup', () => ({type: TERM_GROUP_REQUEST})),
  // Both splits dispatch `SESSION_REQUEST`; the direction lives in the effect,
  // so the test distinguishes them by which creator the handler chose.
  requestHorizontalSplit: thunk('requestHorizontalSplit', () => ({type: SESSION_REQUEST})),
  requestVerticalSplit: thunk('requestVerticalSplit', () => ({type: SESSION_REQUEST})),
  exitActiveTermGroup: thunk('exitActiveTermGroup', () => ({type: TERM_GROUP_EXIT_ACTIVE})),
  // Written out rather than built by `thunk`: the production creator returns
  // the dispatched session-exit action, and `BootstrapActionModules` names that
  // exact type, so the shape has to match branch for branch.
  ptyExitTermGroup: (uid: string) => (dispatch: HyperDispatch) => {
    record('ptyExitTermGroup', [uid]);
    return dispatch({
      type: SESSION_PTY_EXIT,
      uid: asSessionId(uid),
      effect() {
        // The real effect also closes the window when no sessions remain; the
        // wiring under test never invokes it, so it stays empty here.
      }
    });
  }
};

const uiActions = {
  setFontSmoothing: thunk('setFontSmoothing', () => ({type: UI_FONT_SMOOTHING_SET, fontSmoothing: 'antialiased'})),
  resetFontSize: action('resetFontSize', () => ({type: UI_FONT_SIZE_RESET})),
  increaseFontSize: thunk('increaseFontSize', () => ({type: UI_FONT_SIZE_INCR})),
  decreaseFontSize: thunk('decreaseFontSize', () => ({type: UI_FONT_SIZE_DECR})),
  moveLeft: thunk('moveLeft', () => ({type: UI_MOVE_LEFT})),
  moveRight: thunk('moveRight', () => ({type: UI_MOVE_RIGHT})),
  moveTo: thunk('moveTo', () => ({type: UI_MOVE_TO})),
  moveToNextPane: thunk('moveToNextPane', () => ({type: UI_MOVE_NEXT_PANE})),
  moveToPreviousPane: thunk('moveToPreviousPane', () => ({type: UI_MOVE_PREV_PANE})),
  openFile: thunk('openFile', () => ({type: UI_OPEN_FILE})),
  openSSH: thunk('openSSH', () => ({type: UI_OPEN_SSH_URL})),
  windowGeometryUpdated: action('windowGeometryUpdated', ({isMaximized}: {isMaximized: boolean}) => ({
    type: UI_WINDOW_GEOMETRY_CHANGED,
    isMaximized
  })),
  windowMove: thunk('windowMove', () => ({type: UI_WINDOW_MOVE})),
  enterFullScreen: action('enterFullScreen', () => ({type: UI_ENTER_FULLSCREEN})),
  leaveFullScreen: action('leaveFullScreen', () => ({type: UI_LEAVE_FULLSCREEN}))
};

const updaterActions = {
  updateAvailable: action('updateAvailable', ({releaseName, notes, releaseUrl, canInstall}: UpdateAvailableParams) => ({
    type: UPDATE_AVAILABLE,
    version: releaseName,
    notes,
    releaseUrl,
    canInstall
  }))
};

const addNotificationMessage = action(
  'addNotificationMessage',
  ({text, url = null, dismissable = true}: AddNotificationParams) => ({
    type: NOTIFICATION_MESSAGE,
    text,
    url,
    dismissable
  })
);

const loadConfig = action('loadConfig', (config: configOptions) => ({type: CONFIG_LOAD, config}));
const reloadConfig = action('reloadConfig', (config: configOptions) => ({type: CONFIG_RELOAD, config, now: 0}));

/** `lib/actions/index.ts` returns a thunk, and the ready handler dispatches it. */
const init = thunk('init', () => ({type: INIT}));

export const createBootstrapActions = () => ({
  addNotificationMessage,
  init,
  loadConfig,
  reloadConfig,
  sessionActions,
  termGroupActions,
  uiActions,
  updaterActions
});

export const getListener = (event: string): Listener => {
  const handlers = transportOnCalls[event];
  const lastHandler = handlers?.at(-1);
  if (!lastHandler) {
    throw new Error(`Expected transport listener for ${event}`);
  }
  return lastHandler;
};

export const resetFixture = () => {
  dispatchMock.mockClear();
  pluginReloadCount = 0;
  recordedCalls.length = 0;
  transport.invoke.mockClear();
  transport.emit.mockClear();
  transport.off.mockClear();
  transport.once.mockClear();
  transport.removeAllListeners.mockClear();
  transport.destroy.mockClear();
  transport.on.mockClear();
  transport.on.mockImplementation(registerTransportListener);
  Object.keys(transportOnCalls).forEach((key) => {
    transportOnCalls[key] = [];
  });
};
