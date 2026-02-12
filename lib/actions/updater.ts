import {UPDATE_INSTALL, UPDATE_AVAILABLE} from '@shared/constants/updater';
import type {HyperActions} from '../../typings/hyper';
import {transport} from '../transport/electron-ipc-transport';

export function installUpdate(): HyperActions {
  return {
    type: UPDATE_INSTALL,
    effect: () => {
      transport.emit('quit and install');
    }
  };
}

export function updateAvailable(version: string, notes: string, releaseUrl: string, canInstall: boolean): HyperActions {
  return {
    type: UPDATE_AVAILABLE,
    version,
    notes,
    releaseUrl,
    canInstall
  };
}
