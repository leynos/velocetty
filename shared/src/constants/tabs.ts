/** @file Shared tab action constants and action contracts. */
/** Action type constant for closing the active tab. */
export const CLOSE_TAB = 'CLOSE_TAB';
/** Action type constant for changing the active tab. */
export const CHANGE_TAB = 'CHANGE_TAB';

/** Action contract for close-tab events. */
export interface CloseTabAction {
  /** Discriminates this action as `CLOSE_TAB`. */
  readonly type: typeof CLOSE_TAB;
}

/** Action contract for change-tab events. */
export interface ChangeTabAction {
  /** Discriminates this action as `CHANGE_TAB`. */
  readonly type: typeof CHANGE_TAB;
}

/** Union type for tab actions. */
export type TabActions = CloseTabAction | ChangeTabAction;
