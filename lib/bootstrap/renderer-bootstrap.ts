/** @file Extracts renderer bootstrap wiring into injectable helpers for tests. */
import type {configOptions} from '@shared/types/config';
import type {RendererEvents} from '@shared/types/common';
import type {RendererCommandTransport} from '@shared/types/transport';

export type AddSessionDataParams = {uid: string; data: string};
export type SendSessionDataParams = {uid: string | null; data: string; escaped?: boolean};
export type SplitRequestParams = {activeUid?: string; profile?: string};
export type AddNotificationParams = {text: string; url: string | null; dismissable: boolean};
export type UpdateAvailableParams = {
  releaseName: string;
  notes: string;
  releaseUrl: string;
  canInstall: boolean;
};

type StoreState = {
  ui: {
    bellSound: string | null;
    bellSoundURL?: string | null;
  };
};

type StoreLike = {
  dispatch: (action: unknown) => unknown;
  getState: () => StoreState;
};

type ConfigModuleLike = {
  getConfig: () => configOptions;
  subscribe: (listener: () => void) => undefined | (() => void);
};

type PluginModuleLike = {
  reload: () => void;
};

type WindowGlobalsLike = {
  config?: unknown;
  plugins?: unknown;
  rpc?: unknown;
  store?: unknown;
};

type MountResult =
  | {
      unmount?: () => void;
    }
  | undefined;

type SessionActionModule = {
  addSession: (session: unknown) => unknown;
  addSessionData: (params: AddSessionDataParams) => unknown;
  sendSessionData: (params: SendSessionDataParams) => unknown;
  openSearch: () => unknown;
  closeSearch: () => unknown;
  clearActiveSession: () => unknown;
};

type TermGroupActionModule = {
  requestTermGroup: (params?: SplitRequestParams) => unknown;
  requestHorizontalSplit: (params?: SplitRequestParams) => unknown;
  requestVerticalSplit: (params?: SplitRequestParams) => unknown;
  exitActiveTermGroup: () => unknown;
  ptyExitTermGroup: (uid: string) => unknown;
};

type UiActionModule = {
  setFontSmoothing: () => unknown;
  resetFontSize: () => unknown;
  increaseFontSize: () => unknown;
  decreaseFontSize: () => unknown;
  moveLeft: () => unknown;
  moveRight: () => unknown;
  moveTo: (index: number | 'last') => unknown;
  moveToNextPane: () => unknown;
  moveToPreviousPane: () => unknown;
  openFile: (path: string) => unknown;
  openSSH: (parsedUrl: unknown) => unknown;
  windowGeometryUpdated: (data: {isMaximized: boolean}) => unknown;
  windowMove: (window: {bounds: {x: number; y: number}}) => unknown;
  enterFullScreen: () => unknown;
  leaveFullScreen: () => unknown;
};

type UpdaterActionModule = {
  updateAvailable: (params: UpdateAvailableParams) => unknown;
};

type BootstrapActionModules = {
  addNotificationMessage: (params: AddNotificationParams) => unknown;
  init: () => unknown;
  loadConfig: (config: configOptions) => unknown;
  reloadConfig: (config: configOptions) => unknown;
  sessionActions: SessionActionModule;
  termGroupActions: TermGroupActionModule;
  uiActions: UiActionModule;
  updaterActions: UpdaterActionModule;
};

type WindowLike = WindowGlobalsLike &
  typeof globalThis & {
    document: Document;
  };

export type RendererBootstrapDependencies = {
  actions: BootstrapActionModules;
  config: ConfigModuleLike;
  configureStore: () => StoreLike;
  getBase64FileData: (path: string) => Promise<string | null>;
  mountApp: (store: StoreLike) => MountResult;
  platform: NodeJS.Platform;
  plugins: PluginModuleLike;
  rpc: unknown;
  transport: RendererCommandTransport;
  webFrame?: {
    setZoomFactor: (zoomFactor: number) => void;
  };
  windowObject: WindowLike;
};

type RendererBootstrapHandle = {
  dispose: () => void;
  store: StoreLike;
};

/**
 * Sets the historical Linux zoom factor so Electron 40 preserves renderer size
 * expectations.
 */
export const configureRendererZoom = ({
  platform,
  webFrame
}: Pick<RendererBootstrapDependencies, 'platform' | 'webFrame'>): void => {
  if (platform === 'linux') {
    webFrame?.setZoomFactor(1.2);
  }
};

/**
 * Exposes renderer singletons through lazy window properties to preserve
 * existing runtime globals.
 */
export const exposeRendererGlobals = ({
  config,
  plugins,
  rpc,
  store,
  windowObject
}: {
  config: ConfigModuleLike;
  plugins: PluginModuleLike;
  rpc: unknown;
  store: StoreLike;
  windowObject: WindowGlobalsLike;
}): void => {
  Object.defineProperty(windowObject, 'store', {configurable: true, get: () => store});
  Object.defineProperty(windowObject, 'rpc', {configurable: true, get: () => rpc});
  Object.defineProperty(windowObject, 'config', {configurable: true, get: () => config});
  Object.defineProperty(windowObject, 'plugins', {configurable: true, get: () => plugins});
};

/**
 * Initializes config state and keeps bell-sound hydration aligned with later
 * config change events.
 */
const isBellSoundEnabled = (config: configOptions): config is configOptions & {bellSoundURL: string} =>
  config.bell?.toUpperCase() === 'SOUND' && Boolean(config.bellSoundURL);

export const initializeRendererConfig = ({
  actions,
  config,
  getBase64FileData,
  store
}: Pick<RendererBootstrapDependencies, 'actions' | 'config' | 'getBase64FileData'> & {
  store: StoreLike;
}): (() => void) => {
  const fetchFileData = (configData: configOptions) => {
    const configInfo: configOptions = {...configData, bellSound: null};
    if (!isBellSoundEnabled(configInfo)) {
      store.dispatch(actions.reloadConfig(configInfo));
      return;
    }

    void getBase64FileData(configInfo.bellSoundURL).then((base64FileData) => {
      // Prepend "base64," so xterm.js can decode the in-memory bell sound.
      const bellSound = base64FileData == null ? null : `base64,${base64FileData}`;
      configInfo.bellSound = bellSound;
      store.dispatch(actions.reloadConfig(configInfo));
    });
  };

  store.dispatch(actions.loadConfig(config.getConfig()));
  fetchFileData(config.getConfig());

  const unsubscribe =
    config.subscribe(() => {
      const configInfo = config.getConfig();
      configInfo.bellSound = store.getState().ui.bellSound;
      if (store.getState().ui.bellSoundURL !== config.getConfig().bellSoundURL) {
        fetchFileData(configInfo);
      } else {
        store.dispatch(actions.reloadConfig(configInfo));
      }
    }) ?? (() => {});

  return unsubscribe;
};

/**
 * Registers renderer transport listeners and returns a cleanup hook that
 * removes them again, allowing deterministic test teardown.
 */
export const registerRendererTransportListeners = ({
  actions,
  plugins,
  store,
  transport
}: Pick<RendererBootstrapDependencies, 'actions' | 'plugins' | 'transport'> & {
  store: StoreLike;
}): (() => void) => {
  const removers: Array<() => void> = [];

  const register = <Event extends keyof RendererEvents>(
    event: Event,
    listener: (payload: RendererEvents[Event]) => void
  ) => {
    transport.on(event, listener);
    removers.push(() => {
      transport.off(event, listener);
    });
  };

  register('ready', () => {
    store.dispatch(actions.init());
    store.dispatch(actions.uiActions.setFontSmoothing());
  });
  register('session add', (data) => {
    store.dispatch(actions.sessionActions.addSession(data));
  });
  register('session data', (data) => {
    const uid = data.slice(0, 36);
    store.dispatch(actions.sessionActions.addSessionData({uid, data: data.slice(36)}));
  });
  register('session data send', ({uid, data, escaped}) => {
    store.dispatch(actions.sessionActions.sendSessionData({uid, data, escaped}));
  });
  register('session exit', ({uid}) => {
    store.dispatch(actions.termGroupActions.ptyExitTermGroup(uid));
  });
  register('termgroup close req', () => {
    store.dispatch(actions.termGroupActions.exitActiveTermGroup());
  });
  register('session clear req', () => {
    store.dispatch(actions.sessionActions.clearActiveSession());
  });
  register('session move word left req', () => {
    store.dispatch(actions.sessionActions.sendSessionData({uid: null, data: '\x1bb'}));
  });
  register('session move word right req', () => {
    store.dispatch(actions.sessionActions.sendSessionData({uid: null, data: '\x1bf'}));
  });
  register('session move line beginning req', () => {
    store.dispatch(actions.sessionActions.sendSessionData({uid: null, data: '\x1bOH'}));
  });
  register('session move line end req', () => {
    store.dispatch(actions.sessionActions.sendSessionData({uid: null, data: '\x1bOF'}));
  });
  register('session del word left req', () => {
    store.dispatch(actions.sessionActions.sendSessionData({uid: null, data: '\x1b\x7f'}));
  });
  register('session del word right req', () => {
    store.dispatch(actions.sessionActions.sendSessionData({uid: null, data: '\x1bd'}));
  });
  register('session del line beginning req', () => {
    store.dispatch(actions.sessionActions.sendSessionData({uid: null, data: '\x1bw'}));
  });
  register('session del line end req', () => {
    store.dispatch(actions.sessionActions.sendSessionData({uid: null, data: '\x10B'}));
  });
  register('session break req', () => {
    store.dispatch(actions.sessionActions.sendSessionData({uid: null, data: '\x03'}));
  });
  register('session stop req', () => {
    store.dispatch(actions.sessionActions.sendSessionData({uid: null, data: '\x1a'}));
  });
  register('session quit req', () => {
    store.dispatch(actions.sessionActions.sendSessionData({uid: null, data: '\x1c'}));
  });
  register('session tmux req', () => {
    store.dispatch(actions.sessionActions.sendSessionData({uid: null, data: '\x02'}));
  });
  register('session search', () => {
    store.dispatch(actions.sessionActions.openSearch());
  });
  register('session search close', () => {
    store.dispatch(actions.sessionActions.closeSearch());
  });
  register('termgroup add req', ({activeUid, profile}) => {
    store.dispatch(actions.termGroupActions.requestTermGroup({activeUid, profile}));
  });
  register('split request horizontal', ({activeUid, profile}) => {
    store.dispatch(actions.termGroupActions.requestHorizontalSplit({activeUid, profile}));
  });
  register('split request vertical', ({activeUid, profile}) => {
    store.dispatch(actions.termGroupActions.requestVerticalSplit({activeUid, profile}));
  });
  register('reset fontSize req', () => {
    store.dispatch(actions.uiActions.resetFontSize());
  });
  register('increase fontSize req', () => {
    store.dispatch(actions.uiActions.increaseFontSize());
  });
  register('decrease fontSize req', () => {
    store.dispatch(actions.uiActions.decreaseFontSize());
  });
  register('move left req', () => {
    store.dispatch(actions.uiActions.moveLeft());
  });
  register('move right req', () => {
    store.dispatch(actions.uiActions.moveRight());
  });
  register('move jump req', (index) => {
    store.dispatch(actions.uiActions.moveTo(index));
  });
  register('next pane req', () => {
    store.dispatch(actions.uiActions.moveToNextPane());
  });
  register('prev pane req', () => {
    store.dispatch(actions.uiActions.moveToPreviousPane());
  });
  register('open file', ({path}) => {
    store.dispatch(actions.uiActions.openFile(path));
  });
  register('open ssh', (parsedUrl) => {
    store.dispatch(actions.uiActions.openSSH(parsedUrl));
  });
  register('update available', ({releaseName, releaseNotes, releaseUrl, canInstall}) => {
    store.dispatch(actions.updaterActions.updateAvailable({releaseName, notes: releaseNotes, releaseUrl, canInstall}));
  });
  register('move', (window) => {
    store.dispatch(actions.uiActions.windowMove(window));
  });
  register('windowGeometry change', (data) => {
    store.dispatch(actions.uiActions.windowGeometryUpdated(data));
  });
  register('add notification', ({text, url, dismissable}) => {
    store.dispatch(actions.addNotificationMessage({text, url, dismissable}));
  });
  register('enter full screen', () => {
    store.dispatch(actions.uiActions.enterFullScreen());
  });
  register('leave full screen', () => {
    store.dispatch(actions.uiActions.leaveFullScreen());
  });
  register('reload', () => {
    plugins.reload();
  });

  return () => {
    for (const remove of removers.reverse()) {
      remove();
    }
  };
};

// Keep a concise alias for test helpers and bootstrap-focused imports.
export const registerTransportListeners = registerRendererTransportListeners;

/**
 * Starts the renderer bootstrap flow with injectable dependencies so tests can
 * exercise the wiring without module-scope mocks.
 */
export const startRendererApplication = (dependencies: RendererBootstrapDependencies): RendererBootstrapHandle => {
  configureRendererZoom(dependencies);

  const store = dependencies.configureStore();
  exposeRendererGlobals({
    config: dependencies.config,
    plugins: dependencies.plugins,
    rpc: dependencies.rpc,
    store,
    windowObject: dependencies.windowObject
  });

  const unsubscribeConfig = initializeRendererConfig({
    actions: dependencies.actions,
    config: dependencies.config,
    getBase64FileData: dependencies.getBase64FileData,
    store
  });
  const removeTransportListeners = registerRendererTransportListeners({
    actions: dependencies.actions,
    plugins: dependencies.plugins,
    store,
    transport: dependencies.transport
  });
  const mountedApp = dependencies.mountApp(store);

  return {
    store,
    dispose: () => {
      mountedApp?.unmount?.();
      unsubscribeConfig();
      removeTransportListeners();
    }
  };
};
