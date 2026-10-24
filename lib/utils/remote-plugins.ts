/** @file Resolves and loads the main-process plugins module in the renderer. */
import path from 'node:path';

import type * as ElectronRemote from '@electron/remote';
import type {IpcCommands} from '@shared/types/common';
import {isFunction, isObject, isString} from '@shared/types/guards';
export type {VelocettyRuntimeGlobals} from '../../typings/runtime-globals';

export type RemotePluginsModule = Pick<
  IpcCommands,
  | 'getLoadedPluginVersions'
  | 'getPaths'
  | 'getBasePaths'
  | 'getDeprecatedConfig'
  | 'getDecoratedConfig'
  | 'getDecoratedKeymaps'
>;

type ElectronRemoteApi = Pick<typeof ElectronRemote, 'getCurrentWindow' | 'getGlobal' | 'require'>;
type RuntimeGlobalScope = Omit<typeof globalThis, 'window'> & {window?: Window};

const isElectronRemoteApi = (candidate: unknown): candidate is ElectronRemoteApi =>
  isObject(candidate) &&
  'getCurrentWindow' in candidate &&
  isFunction(candidate.getCurrentWindow) &&
  'getGlobal' in candidate &&
  isFunction(candidate.getGlobal) &&
  'require' in candidate &&
  isFunction(candidate.require);

export const getElectronRemoteApi = (): ElectronRemoteApi => {
  // SAFETY: Node unit tests omit `window`; Electron exposes it in the renderer.
  const runtimeGlobal = globalThis as RuntimeGlobalScope;
  const electronRequire = runtimeGlobal.window?.require;
  if (!isFunction(electronRequire)) {
    throw new Error('Electron remote APIs are unavailable outside the renderer process.');
  }

  const remote = electronRequire('@electron/remote');
  if (!isElectronRemoteApi(remote)) {
    throw new TypeError('The @electron/remote module does not expose its expected APIs.');
  }

  return remote;
};

const isRemotePluginsModule = (candidate: unknown): candidate is RemotePluginsModule =>
  isObject(candidate) &&
  'getLoadedPluginVersions' in candidate &&
  isFunction(candidate.getLoadedPluginVersions) &&
  'getPaths' in candidate &&
  isFunction(candidate.getPaths) &&
  'getBasePaths' in candidate &&
  isFunction(candidate.getBasePaths) &&
  'getDeprecatedConfig' in candidate &&
  isFunction(candidate.getDeprecatedConfig) &&
  'getDecoratedConfig' in candidate &&
  isFunction(candidate.getDecoratedConfig) &&
  'getDecoratedKeymaps' in candidate &&
  isFunction(candidate.getDecoratedKeymaps);

const getCandidatePluginModulePaths = (remote: ElectronRemoteApi): string[] => {
  const runtimeAppRoot = remote.getGlobal('__velocettyAppRoot');
  const appRootPath = isString(runtimeAppRoot) ? runtimeAppRoot : undefined;
  const candidates = [
    appRootPath ? path.resolve(appRootPath, 'plugins') : undefined,
    path.resolve(process.cwd(), 'dist', 'app', 'plugins')
  ].filter((candidate): candidate is string => Boolean(candidate));
  return [...new Set(candidates)];
};

export const loadRemotePluginsModule = () => {
  const remote = getElectronRemoteApi();
  const candidates = getCandidatePluginModulePaths(remote);
  let lastError: Error | undefined;

  for (const modulePath of candidates) {
    try {
      const candidate = remote.require(modulePath);
      if (isRemotePluginsModule(candidate)) {
        return candidate;
      }
      lastError = new TypeError(`The plugin module at "${modulePath}" does not expose the expected IPC commands.`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error(`Unable to resolve main-process plugins module. Tried: ${candidates.join(', ')}`, {
    cause: lastError
  });
};
