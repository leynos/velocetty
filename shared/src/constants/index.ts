/** @file Shared bootstrap action constants and action contracts. */
export const INIT = 'INIT';

export interface InitAction {
  type: typeof INIT;
}

export type InitActions = InitAction;
