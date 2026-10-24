/** @file Shared module mock helpers for `lib/utils/plugins` in unit tests. */
import {registerModuleMock} from './mock-module';
import type {IUiReducer, ISessionReducer, ITermGroupReducer, TabsProps} from '../../typings/hyper';

type PluginDecorator = <Component extends object>(Component: Component) => Component;

export type PluginsMockExports = {
  connect: () => PluginDecorator;
  decorate: PluginDecorator;
  decorateSessionsReducer: (reducer: ISessionReducer) => ISessionReducer;
  decorateTermGroupsReducer: (reducer: ITermGroupReducer) => ITermGroupReducer;
  decorateUIReducer: (reducer: IUiReducer) => IUiReducer;
  getTabProps: <Props extends object>(
    tab: TabsProps['tabs'][number] & {tabIndex: number},
    parentProps: TabsProps,
    props: Props
  ) => Props;
  getTabsProps: <Props extends object>(parentProps: unknown, props: Props) => Props;
  subscribeTabDecorationUpdates: (listener: () => void) => () => void;
};

type PluginsModuleFactoryOptions = {
  defaultExportMode?: 'none' | 'self';
};

const createDefaultPluginsMockExports = (): PluginsMockExports => ({
  connect:
    () =>
    <Component extends object>(Component: Component) =>
      Component,
  decorate: <Component extends object>(Component: Component) => Component,
  decorateSessionsReducer: (reducer: ISessionReducer) => reducer,
  decorateTermGroupsReducer: (reducer: ITermGroupReducer) => reducer,
  decorateUIReducer: (reducer: IUiReducer) => reducer,
  getTabProps: <Props extends object>(
    _tab: TabsProps['tabs'][number] & {tabIndex: number},
    _parentProps: TabsProps,
    props: Props
  ) => props,
  getTabsProps: <Props extends object>(_parentProps: unknown, props: Props) => props,
  subscribeTabDecorationUpdates: () => () => {}
});

export const createPluginsMockExports = (overrides: Partial<PluginsMockExports> = {}): PluginsMockExports => ({
  ...createDefaultPluginsMockExports(),
  ...overrides
});

export const createPluginsModuleFactory = (
  overrides: Partial<PluginsMockExports> = {},
  options: PluginsModuleFactoryOptions = {}
) => {
  const defaultExportMode = options.defaultExportMode ?? 'none';
  return () => {
    const pluginExports = createPluginsMockExports(overrides);
    if (defaultExportMode === 'self') {
      return {...pluginExports, default: pluginExports};
    }

    return pluginExports;
  };
};

export const registerPluginsModuleMocks = (
  overrides: Partial<PluginsMockExports> = {},
  options: PluginsModuleFactoryOptions = {}
) => {
  const pluginModuleFactory = createPluginsModuleFactory(overrides, options);
  registerModuleMock('../../lib/utils/plugins', pluginModuleFactory);
  registerModuleMock('../../lib/utils/plugins.ts', pluginModuleFactory);
};
