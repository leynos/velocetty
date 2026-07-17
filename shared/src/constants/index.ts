/** @file Shared bootstrap action constants and action contracts. */

// Re-export config reloadability module
export * from './config-reloadability';

/** Action type constant for bootstrap initialization. */
export const INIT = 'INIT';

/** Action contract for initialization events. */
export interface InitAction {
  /** Discriminates this action as `INIT`. */
  readonly type: typeof INIT;
}

/** Union type for bootstrap actions. */
export type InitActions = InitAction;
