/** @file Extracts renderer bootstrap wiring into injectable helpers for tests. */
import type {configOptions} from '@shared/types/config';
import type {RendererEvents} from '@shared/types/common';
import type {RendererCommandTransport} from '@shared/types/transport';
import {z} from 'zod';
import type {SplitRequestParams} from '../types/request-shapes';

export type AddSessionDataParams = {uid: string; data: string};
export type SendSessionDataParams = {uid: string | null; data: string; escaped?: boolean};
export type AddNotificationParams = {text: string; url?: string | null; dismissable?: boolean};
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

type PayloadRendererEvent = {
  [Event in keyof RendererEvents]: RendererEvents[Event] extends never ? never : Event;
}[keyof RendererEvents];

const sessionIdSchema = z.custom<NonNullable<RendererEvents['session exit']['uid']>>(
  (value) => typeof value === 'string' && value.length > 0,
  'Expected a non-empty session id string.'
);
const profileIdSchema = z.custom<RendererEvents['session add']['profile']>(
  (value) => typeof value === 'string' && value.length > 0,
  'Expected a non-empty profile id string.'
);
const splitRequestParamsSchema = z.object({
  activeUid: sessionIdSchema.optional(),
  profile: profileIdSchema.optional()
});
const rendererEventSchemas: Partial<Record<PayloadRendererEvent, z.ZodType<unknown>>> = {
  'add notification': z.object({
    text: z.string(),
    url: z.string().nullable().default(null),
    dismissable: z.boolean().default(true)
  }),
  'update available': z.object({
    releaseNotes: z.string(),
    releaseName: z.string(),
    releaseUrl: z.string(),
    canInstall: z.boolean()
  }),
  'open ssh': z.custom<RendererEvents['open ssh']>(
    (value) => typeof value === 'object' && value !== null,
    'Expected a parsed SSH URL payload object.'
  ),
  'open file': z.object({path: z.string()}),
  'move jump req': z.union([z.number(), z.literal('last')]),
  'split request horizontal': splitRequestParamsSchema,
  'split request vertical': splitRequestParamsSchema,
  'termgroup add req': splitRequestParamsSchema,
  'session add': z.object({
    uid: sessionIdSchema,
    rows: z.number().nullable().optional(),
    cols: z.number().nullable().optional(),
    splitDirection: z.enum(['HORIZONTAL', 'VERTICAL']).optional(),
    shell: z.string().nullable(),
    pid: z.number().nullable(),
    activeUid: sessionIdSchema.optional(),
    profile: profileIdSchema
  }),
  'session data': z.string().min(36, {error: 'Expected session data to include a 36-character uid prefix.'}),
  'session exit': z.object({uid: sessionIdSchema}),
  'windowGeometry change': z.object({isMaximized: z.boolean()}),
  move: z.object({
    bounds: z.object({
      x: z.number(),
      y: z.number()
    })
  }),
  'session data send': z.object({
    uid: sessionIdSchema.nullable(),
    data: z.string(),
    escaped: z.boolean().optional()
  })
};

const safeInvoke = (label: string, cleanup: () => void, errors: unknown[]): void => {
  try {
    cleanup();
  } catch (error) {
    console.error(`Renderer bootstrap cleanup failed during ${label}.`, error);
    errors.push(error);
  }
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
}): (() => void) => {
  const values = {store, rpc, config, plugins};
  const keys = ['store', 'rpc', 'config', 'plugins'] as const;
  const previousDescriptors = Object.fromEntries(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(windowObject, key)])
  ) as {
    [Key in (typeof keys)[number]]: PropertyDescriptor | undefined;
  };

  const restoreProperties = () => {
    for (const key of keys) {
      const previousDescriptor = previousDescriptors[key];
      if (previousDescriptor) {
        Object.defineProperty(windowObject, key, previousDescriptor);
      } else {
        delete (windowObject as Record<string, unknown>)[key];
      }
    }
  };

  try {
    for (const key of keys) {
      Object.defineProperty(windowObject, key, {
        configurable: true,
        get: () => values[key]
      });
    }
  } catch (error) {
    restoreProperties();
    throw error;
  }

  return restoreProperties;
};

/**
 * Initializes config state and keeps bell-sound hydration aligned with later
 * config change events.
 */
const isBellSoundEnabled = (config: configOptions): config is configOptions & {bellSoundURL: string} =>
  typeof config.bell === 'string' && config.bell.toUpperCase() === 'SOUND' && Boolean(config.bellSoundURL);

export const initializeRendererConfig = ({
  actions,
  config,
  getBase64FileData,
  store
}: Pick<RendererBootstrapDependencies, 'actions' | 'config' | 'getBase64FileData'> & {
  store: StoreLike;
}): (() => void) => {
  let activeBellSoundRequest = 0;
  let disposed = false;

  const fetchFileData = (configData: configOptions) => {
    const requestId = ++activeBellSoundRequest;
    const configInfo: configOptions = {...configData, bellSound: null};
    if (!isBellSoundEnabled(configInfo)) {
      store.dispatch(actions.reloadConfig(configInfo));
      return;
    }

    void getBase64FileData(configInfo.bellSoundURL)
      .catch(() => null)
      .then((base64FileData) => {
        if (disposed || requestId !== activeBellSoundRequest) {
          return;
        }
        if (config.getConfig().bellSoundURL !== configInfo.bellSoundURL) {
          return;
        }

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
      const currentUi = store.getState().ui;
      const nextConfig = config.getConfig();
      const configInfo: configOptions = {...nextConfig, bellSound: currentUi.bellSound};
      if (!isBellSoundEnabled(nextConfig)) {
        configInfo.bellSound = null;
        store.dispatch(actions.reloadConfig(configInfo));
        return;
      }

      if (currentUi.bellSoundURL !== configInfo.bellSoundURL || currentUi.bellSound == null) {
        fetchFileData(configInfo);
      } else {
        store.dispatch(actions.reloadConfig(configInfo));
      }
    }) ?? (() => {});

  return () => {
    disposed = true;
    activeBellSoundRequest += 1;
    unsubscribe();
  };
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
    const schema = rendererEventSchemas[event as PayloadRendererEvent] as z.ZodType<RendererEvents[Event]> | undefined;
    const wrappedListener = (payload: RendererEvents[Event]) => {
      if (!schema) {
        listener(payload);
        return;
      }

      const parsedPayload = schema.safeParse(payload);
      if (!parsedPayload.success) {
        console.error(`Ignoring invalid renderer transport payload for "${event}".`, parsedPayload.error);
        return;
      }

      listener(parsedPayload.data as RendererEvents[Event]);
    };

    transport.on(event, wrappedListener);
    removers.push(() => {
      transport.off(event, wrappedListener);
    });
  };

  try {
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
      store.dispatch(
        actions.updaterActions.updateAvailable({releaseName, notes: releaseNotes, releaseUrl, canInstall})
      );
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
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const remove of [...removers].reverse()) {
      safeInvoke('transport listener removal (rollback)', remove, rollbackErrors);
    }
    throw error;
  }

  return () => {
    const cleanupErrors: unknown[] = [];
    for (const remove of [...removers].reverse()) {
      safeInvoke('transport listener removal', remove, cleanupErrors);
    }
    if (cleanupErrors.length === 1) {
      throw cleanupErrors[0];
    }
    if (cleanupErrors.length > 1) {
      throw new AggregateError(cleanupErrors, 'Renderer transport cleanup failed.');
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
  let restoreWindowGlobals = () => {};
  let unsubscribeConfig = () => {};
  let removeTransportListeners = () => {};
  let mountedApp: MountResult;

  try {
    restoreWindowGlobals = exposeRendererGlobals({
      config: dependencies.config,
      plugins: dependencies.plugins,
      rpc: dependencies.rpc,
      store,
      windowObject: dependencies.windowObject
    });
    unsubscribeConfig = initializeRendererConfig({
      actions: dependencies.actions,
      config: dependencies.config,
      getBase64FileData: dependencies.getBase64FileData,
      store
    });
    removeTransportListeners = registerRendererTransportListeners({
      actions: dependencies.actions,
      plugins: dependencies.plugins,
      store,
      transport: dependencies.transport
    });
    mountedApp = dependencies.mountApp(store);
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    safeInvoke('restoreWindowGlobals', restoreWindowGlobals, rollbackErrors);
    safeInvoke('removeTransportListeners', removeTransportListeners, rollbackErrors);
    safeInvoke('unsubscribeConfig', unsubscribeConfig, rollbackErrors);
    throw error;
  }

  return {
    store,
    dispose: () => {
      const cleanupErrors: unknown[] = [];
      safeInvoke(
        'mountedApp.unmount',
        () => {
          mountedApp?.unmount?.();
        },
        cleanupErrors
      );
      safeInvoke('restoreWindowGlobals', restoreWindowGlobals, cleanupErrors);
      safeInvoke('unsubscribeConfig', unsubscribeConfig, cleanupErrors);
      safeInvoke('removeTransportListeners', removeTransportListeners, cleanupErrors);

      if (cleanupErrors.length === 1) {
        throw cleanupErrors[0];
      }
      if (cleanupErrors.length > 1) {
        throw new AggregateError(cleanupErrors, 'Renderer bootstrap dispose failed.');
      }
    }
  };
};
