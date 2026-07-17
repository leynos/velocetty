/** @file Shared terminal group action constants and action contracts. */
import type {TermGroupId} from '../types/common';

/** Action type constant for requesting a new terminal group. */
export const TERM_GROUP_REQUEST = 'TERM_GROUP_REQUEST';
/** Action type constant for exiting a specified terminal group. */
export const TERM_GROUP_EXIT = 'TERM_GROUP_EXIT';
/** Action type constant for resizing panes within a terminal group. */
export const TERM_GROUP_RESIZE = 'TERM_GROUP_RESIZE';
/** Action type constant for exiting the currently active terminal group. */
export const TERM_GROUP_EXIT_ACTIVE = 'TERM_GROUP_EXIT_ACTIVE';

/** Split orientation for terminal groups. */
export enum DIRECTION {
  /** Panes are arranged side by side. */
  HORIZONTAL = 'HORIZONTAL',
  /** Panes are stacked top to bottom. */
  VERTICAL = 'VERTICAL'
}

/** Requests a new terminal group. */
export interface TermGroupRequestAction {
  /** Discriminates this action as `TERM_GROUP_REQUEST`. */
  readonly type: typeof TERM_GROUP_REQUEST;
}

/** Exits the specified terminal group. */
export interface TermGroupExitAction {
  /** Discriminates this action as `TERM_GROUP_EXIT`. */
  readonly type: typeof TERM_GROUP_EXIT;
  /** Identifier of the terminal group to exit. */
  readonly uid: TermGroupId;
}

/** Resizes panes in a terminal group. */
export interface TermGroupResizeAction {
  /** Discriminates this action as `TERM_GROUP_RESIZE`. */
  readonly type: typeof TERM_GROUP_RESIZE;
  /** Identifier of the terminal group being resized. */
  readonly uid: TermGroupId;
  /** New pane sizes, in split order. */
  readonly sizes: number[];
}

/** Exits the currently active terminal group. */
export interface TermGroupExitActiveAction {
  /** Discriminates this action as `TERM_GROUP_EXIT_ACTIVE`. */
  readonly type: typeof TERM_GROUP_EXIT_ACTIVE;
}

/** Union of every shared terminal group action contract. */
export type TermGroupActions =
  | TermGroupRequestAction
  | TermGroupExitAction
  | TermGroupResizeAction
  | TermGroupExitActiveAction;
