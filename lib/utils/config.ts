/** @file Exposes renderer access to decorated config and config-change events. */
// TODO: Should be updates to new async API https://medium.com/@nornagon/electrons-remote-module-considered-harmful-70d69500f31

import {ipcRenderer} from './ipc';
import {getElectronRemoteApi, loadRemotePluginsModule} from './remote-plugins';

let plugins: ReturnType<typeof loadRemotePluginsModule> | undefined;
const getPlugins = () => {
  plugins ??= loadRemotePluginsModule();
  return plugins;
};

const getProfileName = () => getElectronRemoteApi().getCurrentWindow().profileName;

Object.defineProperty(globalThis, 'profileName', {
  get() {
    return getProfileName();
  },
  set() {
    throw new Error('profileName is readonly');
  }
});

export function getConfig() {
  return getPlugins().getDecoratedConfig(globalThis.profileName);
}

export function subscribe(fn: (event: Electron.IpcRendererEvent, ...args: any[]) => void) {
  ipcRenderer.on('config change', fn);
  ipcRenderer.on('plugins change', fn);
  return () => {
    ipcRenderer.removeListener('config change', fn);
  };
}
