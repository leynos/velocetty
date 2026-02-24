/** @file Shared module mock helpers for `lib/utils/plugins` in unit tests. */
import {mock} from 'bun:test';

type PluginDecorator = (Component: unknown) => unknown;

export type PluginsMockExports = {
  connect: () => PluginDecorator;
  decorate: PluginDecorator;
  getTabProps: (tab: unknown, parentProps: unknown, props: unknown) => unknown;
  subscribeTabDecorationUpdates: (listener: () => void) => () => void;
};

type PluginsModuleFactoryOptions = {
  defaultExportMode?: 'none' | 'self';
};

const createDefaultPluginsMockExports = (): PluginsMockExports => ({
  connect: () => (Component: unknown) => Component,
  decorate: (Component: unknown) => Component,
  getTabProps: (_tab: unknown, _parentProps: unknown, props: unknown) => props,
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
  mock.module('../../lib/utils/plugins', pluginModuleFactory);
  mock.module('../../lib/utils/plugins.ts', pluginModuleFactory);
};
