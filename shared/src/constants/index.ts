/** @file Shared bootstrap action constants and action contracts. */
/** Action type constant for bootstrap initialization. */
export const INIT = 'INIT';

/** Action contract for initialization events. */
export interface InitAction {
  readonly type: typeof INIT;
}

/** Union type for bootstrap actions. */
export type InitActions = InitAction;
