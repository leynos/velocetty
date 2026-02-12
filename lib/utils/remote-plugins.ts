/** @file Resolves and loads the main-process plugins module in the renderer. */
import path from 'node:path';

import {getGlobal, require as remoteRequire} from '@electron/remote';
import type {IpcCommands} from '@shared/types/common';
import type {VelocettyRuntimeGlobals} from '../../typings/runtime-globals';

export type {VelocettyRuntimeGlobals};

export type RemotePluginsModule = Pick<
  IpcCommands,
  | 'getLoadedPluginVersions'
  | 'getPaths'
  | 'getBasePaths'
  | 'getDeprecatedConfig'
  | 'getDecoratedConfig'
  | 'getDecoratedKeymaps'
>;

const getCandidatePluginModulePaths = (): string[] => {
  const appRootPath = getGlobal('__velocettyAppRoot') as VelocettyRuntimeGlobals['__velocettyAppRoot'];
  const candidates = [
    appRootPath ? path.resolve(appRootPath, 'plugins') : undefined,
    path.resolve(process.cwd(), 'target', 'plugins'),
    path.resolve(__dirname, 'plugins')
  ].filter((candidate): candidate is string => Boolean(candidate));
  return Array.from(new Set(candidates));
};

export const loadRemotePluginsModule = () => {
  const candidates = getCandidatePluginModulePaths();
  let lastError: unknown;

  for (const modulePath of candidates) {
    try {
      return remoteRequire(modulePath) as RemotePluginsModule;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Unable to resolve main-process plugins module. Tried: ${candidates.join(', ')}`, {
    cause: lastError
  });
};
