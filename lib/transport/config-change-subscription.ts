/**
 * @file Renderer adapter for the main process's payload-free config event.
 *
 * The main process announces a reload with `webContents.send('config change')`,
 * outside the RPC envelope. This is the one place that reaches `ipcRenderer`
 * for it: settings consumers receive the subscription as a dependency instead,
 * so they stay free of Electron-backed IPC.
 */

import {ipcRenderer} from '../utils/ipc';

/** Subscribes to reload announcements and returns the unsubscribe function. */
export type ConfigChangeSubscription = (onChanged: () => void) => () => void;

/**
 * Subscribes to the main process's config change event.
 *
 * @param onChanged - Called after every reload.
 * @returns The unsubscribe function.
 *
 * @example
 * const unsubscribe = subscribeToConfigChange(() => reloadConfig());
 * unsubscribe(); // removes the listener again
 */
export const subscribeToConfigChange: ConfigChangeSubscription = (onChanged) => {
  const handler = () => onChanged();
  ipcRenderer.on('config change', handler);
  return () => {
    ipcRenderer.removeListener('config change', handler);
  };
};
