/** @file Shared configuration action constants and action contracts. */
import type {configOptions} from '../types/config';

/** Action type constant for loading configuration. */
export const CONFIG_LOAD = 'CONFIG_LOAD';
/** Action type constant for reloading configuration. */
export const CONFIG_RELOAD = 'CONFIG_RELOAD';

/** Action contract for `CONFIG_LOAD` events. */
export interface ConfigLoadAction {
  /** Discriminates this action as `CONFIG_LOAD`. */
  readonly type: typeof CONFIG_LOAD;
  /** Configuration options loaded from disk. */
  readonly config: configOptions;
  /** Timestamp the load completed, when known. */
  readonly now?: number;
}

/** Action contract for `CONFIG_RELOAD` events. */
export interface ConfigReloadAction {
  /** Discriminates this action as `CONFIG_RELOAD`. */
  readonly type: typeof CONFIG_RELOAD;
  /** Configuration options re-read from disk. */
  readonly config: configOptions;
  /** Timestamp the reload completed. */
  readonly now: number;
}

/** Union type for all configuration-related actions. */
export type ConfigActions = ConfigLoadAction | ConfigReloadAction;
