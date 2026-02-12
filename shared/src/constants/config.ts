/** @file Shared configuration action constants and action contracts. */
import type {configOptions} from '../types/config';

export const CONFIG_LOAD = 'CONFIG_LOAD';
export const CONFIG_RELOAD = 'CONFIG_RELOAD';

export interface ConfigLoadAction {
  type: typeof CONFIG_LOAD;
  readonly config: configOptions;
  readonly now?: number;
}

export interface ConfigReloadAction {
  type: typeof CONFIG_RELOAD;
  readonly config: configOptions;
  readonly now: number;
}

export type ConfigActions = ConfigLoadAction | ConfigReloadAction;
