/** @file Shared configuration action constants and action contracts. */
import type {configOptions} from '../types/config';

/** Action type constant for loading configuration. */
export const CONFIG_LOAD = 'CONFIG_LOAD';
/** Action type constant for reloading configuration. */
export const CONFIG_RELOAD = 'CONFIG_RELOAD';

/** Action contract for `CONFIG_LOAD` events. */
export interface ConfigLoadAction {
  readonly type: typeof CONFIG_LOAD;
  readonly config: configOptions;
  readonly now?: number;
}

/** Action contract for `CONFIG_RELOAD` events. */
export interface ConfigReloadAction {
  readonly type: typeof CONFIG_RELOAD;
  readonly config: configOptions;
  readonly now: number;
}

/** Union type for all configuration-related actions. */
export type ConfigActions = ConfigLoadAction | ConfigReloadAction;
