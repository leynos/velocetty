/** @file Exposes renderer access to decorated config and config-change events. */
import {getCurrentWindow} from '@electron/remote';
// TODO: Should be updates to new async API https://medium.com/@nornagon/electrons-remote-module-considered-harmful-70d69500f31

import {ipcRenderer} from './ipc';
import {loadRemotePluginsModule} from './remote-plugins';

const plugins = loadRemotePluginsModule();

Object.defineProperty(window, 'profileName', {
  get() {
    return getCurrentWindow().profileName;
  },
  set() {
    throw new Error('profileName is readonly');
  }
});

/** Returns the plugin-decorated config for the current window's profile. */
export function getConfig() {
  return plugins.getDecoratedConfig(window.profileName);
}

/** Registers `fn` for config and plugin change IPC events, returning an unsubscribe function. */
export function subscribe(fn: (event: Electron.IpcRendererEvent, ...args: any[]) => void) {
  ipcRenderer.on('config change', fn);
  ipcRenderer.on('plugins change', fn);
  return () => {
    ipcRenderer.removeListener('config change', fn);
  };
}
