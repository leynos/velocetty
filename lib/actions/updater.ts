import {UPDATE_INSTALL, UPDATE_AVAILABLE} from '@shared/constants/updater';
import type {HyperActions} from '../../typings/hyper';
import type {UpdateAvailableParams} from '../bootstrap/renderer-bootstrap';
import {transport} from '../transport';

/** Requests that the main process quit and install the downloaded update. */
export function installUpdate(): HyperActions {
  return {
    type: UPDATE_INSTALL,
    effect: () => {
      transport.emit('quit and install');
    }
  };
}

/** Requests that the store record details of a newly available update. */
export function updateAvailable({releaseName, notes, releaseUrl, canInstall}: UpdateAvailableParams): HyperActions {
  return {
    type: UPDATE_AVAILABLE,
    version: releaseName,
    notes,
    releaseUrl,
    canInstall
  };
}
