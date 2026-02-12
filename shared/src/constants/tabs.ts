/** @file Shared tab action constants and action contracts. */
/** Action type constant for closing the active tab. */
export const CLOSE_TAB = 'CLOSE_TAB';
/** Action type constant for changing the active tab. */
export const CHANGE_TAB = 'CHANGE_TAB';

/** Action contract for close-tab events. */
export interface CloseTabAction {
  readonly type: typeof CLOSE_TAB;
}

/** Action contract for change-tab events. */
export interface ChangeTabAction {
  readonly type: typeof CHANGE_TAB;
}

/** Union type for tab actions. */
export type TabActions = CloseTabAction | ChangeTabAction;
