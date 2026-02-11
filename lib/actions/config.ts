import type {configOptions} from '@shared/types/config';
import {CONFIG_LOAD, CONFIG_RELOAD} from '@shared/constants/config';
import type {HyperActions} from '../../typings/hyper';

export function loadConfig(config: configOptions): HyperActions {
  return {
    type: CONFIG_LOAD,
    config
  };
}

export function reloadConfig(config: configOptions): HyperActions {
  const now = Date.now();
  return {
    type: CONFIG_RELOAD,
    config,
    now
  };
}
