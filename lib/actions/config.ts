import type {configOptions} from '@shared/types/config';
import {CONFIG_LOAD, CONFIG_RELOAD} from '@shared/constants/config';
import type {HyperActions} from '../../typings/hyper';

/** Requests that the store load the given config as the current configuration. */
export function loadConfig(config: configOptions): HyperActions {
  return {
    type: CONFIG_LOAD,
    config
  };
}

/** Requests that the store replace the current configuration with a freshly reloaded one. */
export function reloadConfig(config: configOptions): HyperActions {
  const now = Date.now();
  return {
    type: CONFIG_RELOAD,
    config,
    now
  };
}
