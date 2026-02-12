/** @file Shared terminal group action constants and action contracts. */
export const TERM_GROUP_REQUEST = 'TERM_GROUP_REQUEST';
export const TERM_GROUP_EXIT = 'TERM_GROUP_EXIT';
export const TERM_GROUP_RESIZE = 'TERM_GROUP_RESIZE';
export const TERM_GROUP_EXIT_ACTIVE = 'TERM_GROUP_EXIT_ACTIVE';

/** Split orientation for terminal groups. */
export enum DIRECTION {
  HORIZONTAL = 'HORIZONTAL',
  VERTICAL = 'VERTICAL'
}

/** Requests a new terminal group. */
export interface TermGroupRequestAction {
  type: typeof TERM_GROUP_REQUEST;
}

/** Exits the specified terminal group. */
export interface TermGroupExitAction {
  type: typeof TERM_GROUP_EXIT;
  readonly uid: string;
}

/** Resizes panes in a terminal group. */
export interface TermGroupResizeAction {
  type: typeof TERM_GROUP_RESIZE;
  readonly uid: string;
  readonly sizes: number[];
}

/** Exits the currently active terminal group. */
export interface TermGroupExitActiveAction {
  type: typeof TERM_GROUP_EXIT_ACTIVE;
}

/** Union of every shared terminal group action contract. */
export type TermGroupActions =
  | TermGroupRequestAction
  | TermGroupExitAction
  | TermGroupResizeAction
  | TermGroupExitActiveAction;
