import {UPDATE_INSTALL, UPDATE_AVAILABLE} from '@shared/constants/updater';
import type {HyperActions} from '../../typings/hyper';
import type {UpdateAvailableParams} from '../bootstrap/renderer-bootstrap';
import {transport} from '../transport';

export function installUpdate(): HyperActions {
  return {
    type: UPDATE_INSTALL,
    effect: () => {
      transport.emit('quit and install');
    }
  };
}

export function updateAvailable({releaseName, notes, releaseUrl, canInstall}: UpdateAvailableParams): HyperActions {
  return {
    type: UPDATE_AVAILABLE,
    version: releaseName,
    notes,
    releaseUrl,
    canInstall
  };
}
