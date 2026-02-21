/**
 * @file Renderer plugin loading and React/Redux decoration utilities.
 *
 * Responsibilities:
 * - Load renderer plugins and wire them into the Redux/React pipeline.
 * - Provide connector helpers for plugin-authored UI components.
 *
 * Usage:
 * - Imported by renderer entry points to register plugin hooks.
 */
// eslint-disable-next-line eslint-comments/disable-enable-pair
/* eslint-disable @typescript-eslint/no-unsafe-return */
import ChildProcess from 'node:child_process';
import pathModule from 'node:path';

import React, {PureComponent} from 'react';
import type {ComponentType} from 'react';

// TODO: Should be updates to new async API https://medium.com/@nornagon/electrons-remote-module-considered-harmful-70d69500f31
import ReactDOM from 'react-dom';
import {connect as reduxConnect} from 'react-redux';
import type {Dispatch, Middleware} from 'redux';

import type {
  RuntimePluginManifest,
  RuntimeTabDecorationProvider,
  RuntimeTabDecoration as RuntimePluginTabDecoration
} from '@shared/runtime/golden-path-demo';
import {runtimePluginManifests} from '@shared/runtime/golden-path-demo';
import type {
  hyperPlugin,
  IUiReducer,
  ISessionReducer,
  ITermGroupReducer,
  HyperState,
  HyperDispatch,
  TabProps,
  TabsProps,
  TermGroupOwnProps,
  TermProps,
  Assignable,
  HyperActions
} from '../../typings/hyper';
import Notification from '../components/notification';

import IPCChildProcess from './ipc-child-process';
import {getConfig as getRendererConfig, subscribe as subscribeRendererConfig} from './config';
import notify from './notify';
import {ObjectTypedKeys} from './object';
import {loadRemotePluginsModule, type RemotePluginsModule} from './remote-plugins';
import {
  registerTabDecorationProvider,
  resolveTabDecoration,
  subscribeTabDecorationProviderChanges,
  tabDecorationProviders,
  type TabDecoration,
  type TabDecorationBadge,
  type TabDecorationContext,
  type TabDecorationProvider,
  type TabDecorationWidget
} from './tab-decoration-providers';

type ConnectOptions = NonNullable<Parameters<typeof reduxConnect>[3]>;
type LoadedPluginVersion = ReturnType<RemotePluginsModule['getLoadedPluginVersions']>[number];
type PluginHook = ((...args: unknown[]) => unknown) & {
  _pluginName?: string;
  _pluginVersion?: string | null;
};

// remote interface to `../plugins`
const plugins = loadRemotePluginsModule();

// `require`d modules
let modules: hyperPlugin[];

// cache of decorated components
let decorated: Record<string, React.ComponentClass<any>> = {};

// various caches extracted of the plugin methods
let connectors: {
  Terms: {state: any[]; dispatch: any[]};
  Header: {state: any[]; dispatch: any[]};
  Hyper: {state: any[]; dispatch: any[]};
  Notifications: {state: any[]; dispatch: any[]};
};
let middlewares: Middleware[];
let uiReducers: IUiReducer[];
let sessionsReducers: ISessionReducer[];
let termGroupsReducers: ITermGroupReducer[];
let tabPropsDecorators: any[];
let tabsPropsDecorators: any[];
let termPropsDecorators: any[];
let termGroupPropsDecorators: any[];
let propsDecorators: {
  getTermProps: any[];
  getTabProps: any[];
  getTabsProps: any[];
  getTermGroupProps: any[];
};
let reducersDecorators: {
  reduceUI: IUiReducer[];
  reduceSessions: ISessionReducer[];
  reduceTermGroups: ITermGroupReducer[];
};

const buildProviderId = (pluginName: string, providerId: string) => `${pluginName}.${providerId}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isPluginHook = (value: unknown): value is PluginHook => typeof value === 'function';

const resolveRuntimePluginSettings = (manifest: RuntimePluginManifest): Record<string, unknown> => {
  const config = getRendererConfig();
  const pluginNamespace = isRecord(config.plugins) ? config.plugins : {};
  const candidate = pluginNamespace[manifest.id];
  if (isRecord(candidate)) {
    return {...manifest.settingsDefaults, ...candidate};
  }
  return {...manifest.settingsDefaults};
};

const mapRuntimeToTabDecoration = (
  runtimeDecoration: RuntimePluginTabDecoration | null | undefined
): TabDecoration | null | undefined => {
  if (!runtimeDecoration) {
    return undefined;
  }

  const mappedDecoration: TabDecoration = {
    title: runtimeDecoration.title,
    subtitle: runtimeDecoration.subtitle
  };

  if (runtimeDecoration.badges && runtimeDecoration.badges.length > 0) {
    mappedDecoration.badges = runtimeDecoration.badges.map<TabDecorationBadge>((badge) => ({
      text: badge.text,
      icon: badge.icon,
      tooltip: badge.tooltip,
      kind: badge.kind
    }));
  }

  if (runtimeDecoration.widgets && runtimeDecoration.widgets.length > 0) {
    mappedDecoration.widgets = runtimeDecoration.widgets.map<TabDecorationWidget>((widget) => ({
      icon: widget.icon,
      command: widget.command,
      tooltip: widget.tooltip
    }));
  }

  return mappedDecoration;
};

const registerRuntimeProvider = (
  manifest: RuntimePluginManifest,
  provider: RuntimeTabDecorationProvider,
  providerIndex: number
) => {
  const providerId = provider.id.trim().length > 0 ? provider.id.trim() : `provider-${providerIndex + 1}`;
  registerTabDecorationProvider({
    id: buildProviderId(`runtime:${manifest.id}`, providerId),
    priority: provider.priority,
    provideDecoration: (context) => {
      const runtimeSettings = resolveRuntimePluginSettings(manifest);
      if (runtimeSettings.enabled === false) {
        return undefined;
      }

      return mapRuntimeToTabDecoration(provider.provideDecoration(context, runtimeSettings));
    },
    // Emit explicit updates when config reload events occur.
    subscribe: (onDidChange) => subscribeRendererConfig(() => onDidChange())
  });
};

const registerRuntimeTabDecorationProviders = () => {
  runtimePluginManifests.forEach((manifest) => {
    manifest.tabDecorationProviders.forEach((provider, providerIndex) => {
      registerRuntimeProvider(manifest, provider, providerIndex);
    });
  });
};

const registerProvidersFromPlugin = (pluginName: string, providerList: unknown) => {
  if (!Array.isArray(providerList)) {
    return;
  }

  providerList.forEach((candidate, providerIndex) => {
    if (!candidate || typeof candidate !== 'object') {
      return;
    }

    const provider = candidate as Partial<TabDecorationProvider>;
    if (typeof provider.provideDecoration !== 'function') {
      return;
    }

    const baseProviderId =
      typeof provider.id === 'string' && provider.id.trim().length > 0
        ? provider.id.trim()
        : `provider-${providerIndex + 1}`;

    const subscribe =
      typeof provider.subscribe === 'function' ? (provider.subscribe as TabDecorationProvider['subscribe']) : undefined;

    registerTabDecorationProvider({
      id: buildProviderId(pluginName, baseProviderId),
      priority: typeof provider.priority === 'number' ? provider.priority : 0,
      provideDecoration: provider.provideDecoration,
      subscribe
    });
  });
};

type TabLike = {
  uid: string;
  tabIndex: number;
  isActive?: boolean;
  hasActivity?: boolean;
  title?: string;
};

type ParentPropsLike = Record<string, unknown>;

const getTabDecorationContext = (tab: TabLike): TabDecorationContext => {
  return {
    tabId: String(tab.uid),
    tabIndex: typeof tab.tabIndex === 'number' ? tab.tabIndex : 0,
    active: Boolean(tab.isActive),
    hasActivity: Boolean(tab.hasActivity),
    title: typeof tab.title === 'string' ? tab.title : undefined
  };
};

// expose decorated component instance to the higher-order components
function exposeDecorated<P extends Record<string, any>>(
  Component_: React.ComponentType<P>
): React.ComponentClass<P, unknown> {
  return class DecoratedComponent extends React.Component<P> {
    onRef = (decorated_: any) => {
      if (this.props.onDecorated) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call
          this.props.onDecorated(decorated_);
        } catch (e) {
          notify('Plugin error', `Error occurred. Check Developer Tools for details`, {error: e});
        }
      }
    };
    render() {
      return React.createElement(Component_, Object.assign({}, this.props, {ref: this.onRef}));
    }
  };
}

function getDecorated<P extends Record<string, any>>(
  parent: React.ComponentType<P>,
  name: string
): React.ComponentClass<P> {
  if (!decorated[name]) {
    let class_ = exposeDecorated(parent);
    (class_ as any).displayName = `_exposeDecorated(${name})`;

    modules.forEach((mod: any) => {
      const method = `decorate${name}`;
      const fn: Function & {_pluginName: string} = mod[method];

      if (fn) {
        let class__;

        try {
          class__ = fn(class_, {React, PureComponent, Notification, notify});
          class__.displayName = `${fn._pluginName}(${name})`;
        } catch (err) {
          notify(
            'Plugin error',
            `${fn._pluginName}: Error occurred in \`${method}\`. Check Developer Tools for details`,
            {error: err}
          );
          return;
        }

        if (!class__ || typeof class__.prototype.render !== 'function') {
          notify(
            'Plugin error',
            `${fn._pluginName}: Invalid return value of \`${method}\`. No \`render\` method found. Please return a \`React.Component\`.`
          );
          return;
        }

        class_ = class__;
      }
    });

    decorated[name] = class_;
  }

  return decorated[name];
}

// for each component, we return a higher-order component
// that wraps with the higher-order components
// exposed by plugins
export function decorate<P extends Record<string, any>>(
  Component_: React.ComponentType<P>,
  name: string
): React.ComponentClass<P, {hasError: boolean}> {
  return class DecoratedComponent extends React.Component<P, {hasError: boolean}> {
    constructor(props: P) {
      super(props);
      this.state = {hasError: false};
    }
    componentDidCatch() {
      this.setState({hasError: true});
      // No need to detail this error because React print these information.
      notify(
        'Plugin error',
        `Plugins decorating ${name} has been disabled because of a plugin crash. Check Developer Tools for details.`
      );
    }
    render() {
      const Sub = this.state.hasError ? Component_ : getDecorated(Component_, name);
      return React.createElement(Sub, this.props);
    }
  };
}

// patching Module._load
// so plugins can `require` them without needing their own version
// https://github.com/vercel/hyper/issues/619
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('node:module') as typeof import('module') & {_load: Function};
const originalLoad = Module._load;
Module._load = function _load(path: string) {
  // PLEASE NOTE: Code changes here, also need to be changed in
  // app/plugins.js
  switch (path) {
    case 'react':
      console.warn('DEPRECATED: If your plugin requires `react`, it must bundle it as a dependency');
      return React;
    case 'react-dom':
      console.warn('DEPRECATED: If your plugin requires `react-dom`, it must bundle it as a dependency');
      return ReactDOM;
    case 'hyper/component':
      console.warn(
        'DEPRECATED: If your plugin requires `hyper/component`, it must requires `react.PureComponent` instead and bundle `react` as a dependency'
      );
      return PureComponent;
    case 'hyper/notify':
      return notify;
    case 'hyper/Notification':
      return Notification;
    case 'hyper/decorate':
      return decorate;
    case 'child_process':
      return process.platform === 'darwin' ? IPCChildProcess : ChildProcess;
    default:
      // eslint-disable-next-line prefer-rest-params
      return originalLoad.apply(this, arguments);
  }
};

const clearModulesCache = () => {
  // the fs locations where user plugins are stored
  const {path, localPath} = plugins.getBasePaths();

  // trigger unload hooks
  modules.forEach((mod) => {
    if (mod.onRendererUnload) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      mod.onRendererUnload(window);
    }
  });

  // clear require cache
  for (const entry in window.require.cache) {
    if (entry.indexOf(path) === 0 || entry.indexOf(localPath) === 0) {
      // `window.require` resolves the Electron runtime module cache.
      delete window.require.cache[entry];
    }
  }
};

const getPluginName = (path: string) => pathModule.basename(path);

const getPluginVersion = (path: string): string | null => {
  let version: string | null = null;
  try {
    version = window.require(pathModule.resolve(path, 'package.json')).version as string;
  } catch (_err) {
    console.warn(`No package.json found in ${path}`);
  }
  return version;
};

const initializePluginCaches = () => {
  connectors = {
    Terms: {state: [], dispatch: []},
    Header: {state: [], dispatch: []},
    Hyper: {state: [], dispatch: []},
    Notifications: {state: [], dispatch: []}
  };
  uiReducers = [];
  middlewares = [];
  sessionsReducers = [];
  termGroupsReducers = [];
  tabPropsDecorators = [];
  tabsPropsDecorators = [];
  termPropsDecorators = [];
  termGroupPropsDecorators = [];

  propsDecorators = {
    getTermProps: termPropsDecorators,
    getTabProps: tabPropsDecorators,
    getTabsProps: tabsPropsDecorators,
    getTermGroupProps: termGroupPropsDecorators
  };

  reducersDecorators = {
    reduceUI: uiReducers,
    reduceSessions: sessionsReducers,
    reduceTermGroups: termGroupsReducers
  };
};

const registerPluginHooks = (mod: hyperPlugin, pluginName: string, pluginVersion: string | null) => {
  ObjectTypedKeys(mod).forEach((i) => {
    if (!Object.hasOwn(mod, i)) {
      return;
    }

    const pluginHook = mod[i];
    if (isPluginHook(pluginHook)) {
      pluginHook._pluginName = pluginName;
      pluginHook._pluginVersion = pluginVersion;
    }
  });

  // mapHyperTermState mapping for backwards compatibility with hyperterm
  if (mod.mapHyperTermState) {
    mod.mapHyperState = mod.mapHyperTermState;
    console.error('mapHyperTermState is deprecated. Use mapHyperState instead.');
  }

  // mapHyperTermDispatch mapping for backwards compatibility with hyperterm
  if (mod.mapHyperTermDispatch) {
    mod.mapHyperDispatch = mod.mapHyperTermDispatch;
    console.error('mapHyperTermDispatch is deprecated. Use mapHyperDispatch instead.');
  }

  if (mod.middleware) {
    middlewares.push(mod.middleware);
  }

  if (mod.reduceUI) {
    uiReducers.push(mod.reduceUI);
  }

  if (mod.reduceSessions) {
    sessionsReducers.push(mod.reduceSessions);
  }

  if (mod.reduceTermGroups) {
    termGroupsReducers.push(mod.reduceTermGroups);
  }

  if (mod.mapTermsState) {
    connectors.Terms.state.push(mod.mapTermsState);
  }

  if (mod.mapTermsDispatch) {
    connectors.Terms.dispatch.push(mod.mapTermsDispatch);
  }

  if (mod.mapHeaderState) {
    connectors.Header.state.push(mod.mapHeaderState);
  }

  if (mod.mapHeaderDispatch) {
    connectors.Header.dispatch.push(mod.mapHeaderDispatch);
  }

  if (mod.mapHyperState) {
    connectors.Hyper.state.push(mod.mapHyperState);
  }

  if (mod.mapHyperDispatch) {
    connectors.Hyper.dispatch.push(mod.mapHyperDispatch);
  }

  if (mod.mapNotificationsState) {
    connectors.Notifications.state.push(mod.mapNotificationsState);
  }

  if (mod.mapNotificationsDispatch) {
    connectors.Notifications.dispatch.push(mod.mapNotificationsDispatch);
  }

  if (mod.getTermGroupProps) {
    termGroupPropsDecorators.push(mod.getTermGroupProps);
  }

  if (mod.getTermProps) {
    termPropsDecorators.push(mod.getTermProps);
  }

  if (mod.getTabProps) {
    tabPropsDecorators.push(mod.getTabProps);
  }

  if (mod.getTabsProps) {
    tabsPropsDecorators.push(mod.getTabsProps);
  }

  if (mod.onRendererWindow) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    mod.onRendererWindow(window);
  }

  if (typeof mod.getTabDecorationProviders === 'function') {
    try {
      const providerList = mod.getTabDecorationProviders();
      registerProvidersFromPlugin(pluginName, providerList);
    } catch (err) {
      notify(
        'Plugin error',
        `${pluginName}: Error occurred in \`getTabDecorationProviders\`. Check Developer Tools for details.`,
        {
          error: err
        }
      );
    }
  }

  console.log(`Plugin ${pluginName} (${pluginVersion}) loaded.`);
};

const loadPluginModule = (pluginPath: string, loadedPlugins: string[]): hyperPlugin | undefined => {
  if (!loadedPlugins.includes(pathModule.basename(pluginPath))) {
    return undefined;
  }

  const pluginName = getPluginName(pluginPath);
  const pluginVersion = getPluginVersion(pluginPath);
  let mod: hyperPlugin;

  // window.require allows us to ensure this doesn't get
  // in the way of our build
  try {
    mod = window.require(pluginPath);
  } catch (err) {
    notify(
      'Plugin load error',
      `"${pluginName}" failed to load in the renderer process. Check Developer Tools for details.`,
      {
        error: err
      }
    );
    return undefined;
  }

  registerPluginHooks(mod, pluginName, pluginVersion);
  return mod;
};

const loadModules = () => {
  console.log('(re)loading renderer plugins');
  const paths = plugins.getPaths();
  tabDecorationProviders.clear();
  registerRuntimeTabDecorationProviders();

  initializePluginCaches();

  const loadedPlugins = plugins.getLoadedPluginVersions().map((plugin: LoadedPluginVersion) => plugin.name);
  modules = paths.plugins
    .concat(paths.localPlugins)
    .map((pluginPath: string) => loadPluginModule(pluginPath, loadedPlugins))
    .filter((mod: hyperPlugin | undefined): mod is hyperPlugin => Boolean(mod));

  const deprecatedPlugins = plugins.getDeprecatedConfig();
  Object.keys(deprecatedPlugins).forEach((name) => {
    const {css} = deprecatedPlugins[name];
    if (css.length > 0) {
      console.warn(`Warning: "${name}" plugin uses some deprecated CSS classes (${css.join(', ')}).`);
    }
  });
};

// load modules for initial decoration
loadModules();

export function reload() {
  clearModulesCache();
  loadModules();
  // trigger re-decoration when components
  // get re-rendered
  decorated = {};
}

export const subscribeTabDecorationUpdates = (listener: () => void) => {
  return subscribeTabDecorationProviderChanges(listener);
};

function getProps(name: keyof typeof propsDecorators, props: any, ...fnArgs: any[]) {
  const decorators = propsDecorators[name];
  let props_: typeof props;

  decorators.forEach((fn) => {
    let ret_;

    if (!props_) {
      props_ = Object.assign({}, props);
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      ret_ = fn(...fnArgs, props_);
    } catch (err) {
      notify('Plugin error', `${fn._pluginName}: Error occurred in \`${name}\`. Check Developer Tools for details.`, {
        error: err
      });
      return;
    }

    if (!ret_ || typeof ret_ !== 'object') {
      notify('Plugin error', `${fn._pluginName}: Invalid return value of \`${name}\` (object expected).`);
      return;
    }

    props_ = ret_;
  });

  return props_ || props;
}

export function getTermGroupProps<T extends Assignable<TermGroupOwnProps, T>>(
  uid: string,
  parentProps: any,
  props: T
): T {
  return getProps('getTermGroupProps', props, uid, parentProps);
}

export function getTermProps<T extends Assignable<TermProps, T>>(uid: string, parentProps: any, props: T): T {
  return getProps('getTermProps', props, uid, parentProps);
}

export function getTabsProps<T extends Assignable<TabsProps, T>>(parentProps: any, props: T): T {
  return getProps('getTabsProps', props, parentProps);
}

export function getTabProps<T extends Assignable<TabProps, T>>(
  tab: TabLike,
  parentProps: ParentPropsLike,
  props: T
): T {
  const decoration = resolveTabDecoration(getTabDecorationContext(tab));
  const decoratedProps = {
    ...props,
    tabDecoration: decoration,
    tabIndex: tab.tabIndex
  };
  if (decoration.title) {
    decoratedProps.text = decoration.title;
  }

  return getProps('getTabProps', decoratedProps, tab, parentProps);
}

// connects + decorates a class
// plugins can override mapToState, dispatchToProps
// and the class gets decorated (proxied)
export function connect<StateProps extends Record<string, unknown>, DispatchProps extends Record<string, unknown>>(
  stateFn: (state: HyperState) => StateProps,
  dispatchFn: (dispatch: HyperDispatch) => DispatchProps,
  c: null | undefined,
  d: ConnectOptions = {}
) {
  return <P extends Record<string, unknown>>(
    Class: ComponentType<P & StateProps & DispatchProps>,
    name: keyof typeof connectors
  ) => {
    return reduxConnect(
      (state: HyperState) => {
        let ret = stateFn(state);
        connectors[name].state.forEach((fn) => {
          let ret_;

          try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            ret_ = fn(state, ret);
          } catch (err) {
            notify(
              'Plugin error',
              `${fn._pluginName}: Error occurred in \`map${name}State\`. Check Developer Tools for details.`,
              {error: err}
            );
            return;
          }

          if (!ret_ || typeof ret_ !== 'object') {
            notify('Plugin error', `${fn._pluginName}: Invalid return value of \`map${name}State\` (object expected).`);
            return;
          }

          ret = ret_;
        });
        return ret;
      },
      (dispatch: HyperDispatch) => {
        let ret = dispatchFn(dispatch);
        connectors[name].dispatch.forEach((fn) => {
          let ret_;

          try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            ret_ = fn(dispatch, ret);
          } catch (err) {
            notify(
              'Plugin error',
              `${fn._pluginName}: Error occurred in \`map${name}Dispatch\`. Check Developer Tools for details.`,
              {error: err}
            );
            return;
          }

          if (!ret_ || typeof ret_ !== 'object') {
            notify(
              'Plugin error',
              `${fn._pluginName}: Invalid return value of \`map${name}Dispatch\` (object expected).`
            );
            return;
          }

          ret = ret_;
        });
        return ret;
      },
      c,
      d
    )(
      // @ts-expect-error react-redux connect does not type decorated components with explicit props.
      decorate(Class, name)
    );
  };
}

const decorateReducer: {
  (name: 'reduceUI', fn: IUiReducer): IUiReducer;
  (name: 'reduceSessions', fn: ISessionReducer): ISessionReducer;
  (name: 'reduceTermGroups', fn: ITermGroupReducer): ITermGroupReducer;
} = <T extends keyof typeof reducersDecorators>(name: T, fn: any) => {
  const reducers = reducersDecorators[name];
  return (state: any, action: any) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    let state_ = fn(state, action);

    reducers.forEach((pluginReducer: any) => {
      let state__;

      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        state__ = pluginReducer(state_, action);
      } catch (err) {
        notify('Plugin error', `${fn._pluginName}: Error occurred in \`${name}\`. Check Developer Tools for details.`, {
          error: err
        });
        return;
      }

      if (!state__ || typeof state__ !== 'object') {
        notify('Plugin error', `${fn._pluginName}: Invalid return value of \`${name}\`.`);
        return;
      }

      state_ = state__;
    });

    return state_;
  };
};

export function decorateTermGroupsReducer(fn: ITermGroupReducer) {
  return decorateReducer('reduceTermGroups', fn);
}

export function decorateUIReducer(fn: IUiReducer) {
  return decorateReducer('reduceUI', fn);
}

export function decorateSessionsReducer(fn: ISessionReducer) {
  return decorateReducer('reduceSessions', fn);
}

// redux middleware generator
export const middleware: Middleware<{}, HyperState, Dispatch<HyperActions>> = (store) => (next) => (action) => {
  const nextMiddleware = (remaining: Middleware[]) => (action_: any) =>
    remaining.length ? remaining[0](store)(nextMiddleware(remaining.slice(1)))(action_) : next(action_);
  return nextMiddleware(middlewares)(action);
};
