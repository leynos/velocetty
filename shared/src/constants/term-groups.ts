/** @file Shared terminal group action constants and action contracts. */
import type {TermGroupId} from '../types/common';

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
  readonly type: typeof TERM_GROUP_REQUEST;
}

/** Exits the specified terminal group. */
export interface TermGroupExitAction {
  readonly type: typeof TERM_GROUP_EXIT;
  readonly uid: TermGroupId;
}

/** Resizes panes in a terminal group. */
export interface TermGroupResizeAction {
  readonly type: typeof TERM_GROUP_RESIZE;
  readonly uid: TermGroupId;
  readonly sizes: number[];
}

/** Exits the currently active terminal group. */
export interface TermGroupExitActiveAction {
  readonly type: typeof TERM_GROUP_EXIT_ACTIVE;
}

/** Union of every shared terminal group action contract. */
export type TermGroupActions =
  | TermGroupRequestAction
  | TermGroupExitAction
  | TermGroupResizeAction
  | TermGroupExitActiveAction;
