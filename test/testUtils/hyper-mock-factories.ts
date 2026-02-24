/** @file Shared Hyper test types and plugin mock factories. */
import type {ComponentType} from 'react';

import {createPluginsMockExports, createPluginsModuleFactory} from './plugins-mock';

export type HyperProps = {
  activeSession: string | null;
  backgroundColor: string;
  borderColor: string;
  customCSS: string;
  execCommand: (...args: unknown[]) => void;
  fullScreen: boolean;
  isMac: boolean;
  lastConfigUpdate: number;
  maximized: boolean;
  uiFontFamily: string;
};

export type HyperComponent = ComponentType<HyperProps>;

export const createPluginExports = createPluginsMockExports;
export const pluginModuleFactory = createPluginsModuleFactory;
