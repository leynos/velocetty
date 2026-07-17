/** @file Shared user interface action constants and action contracts. */
import type {CommandId} from '../types/commands';

/** Action type constant for setting font size directly. */
export const UI_FONT_SIZE_SET = 'UI_FONT_SIZE_SET';
/** Action type constant for increasing font size. */
export const UI_FONT_SIZE_INCR = 'UI_FONT_SIZE_INCR';
/** Action type constant for decreasing font size. */
export const UI_FONT_SIZE_DECR = 'UI_FONT_SIZE_DECR';
/** Action type constant for resetting font size. */
export const UI_FONT_SIZE_RESET = 'UI_FONT_SIZE_RESET';
/** Action type constant for setting font smoothing mode. */
export const UI_FONT_SMOOTHING_SET = 'UI_FONT_SMOOTHING_SET';
/** Action type constant for moving focus left. */
export const UI_MOVE_LEFT = 'UI_MOVE_LEFT';
/** Action type constant for moving focus right. */
export const UI_MOVE_RIGHT = 'UI_MOVE_RIGHT';
/** Action type constant for jumping to a specific tab index. */
export const UI_MOVE_TO = 'UI_MOVE_TO';
/** Action type constant for moving to the next pane. */
export const UI_MOVE_NEXT_PANE = 'UI_MOVE_NEXT_PANE';
/** Action type constant for moving to the previous pane. */
export const UI_MOVE_PREV_PANE = 'UI_MOVE_PREV_PANE';
/** Action type constant for opening the preferences view. */
export const UI_SHOW_PREFERENCES = 'UI_SHOW_PREFERENCES';
/** Action type constant for moving the window. */
export const UI_WINDOW_MOVE = 'UI_WINDOW_MOVE';
/** Action type constant for maximizing the window. */
export const UI_WINDOW_MAXIMIZE = 'UI_WINDOW_MAXIMIZE';
/** Action type constant for unmaximizing the window. */
export const UI_WINDOW_UNMAXIMIZE = 'UI_WINDOW_UNMAXIMIZE';
/** Action type constant for window geometry updates. */
export const UI_WINDOW_GEOMETRY_CHANGED = 'UI_WINDOW_GEOMETRY_CHANGED';
/** Action type constant for opening a file. */
export const UI_OPEN_FILE = 'UI_OPEN_FILE';
/** Action type constant for opening an SSH URL. */
export const UI_OPEN_SSH_URL = 'UI_OPEN_SSH_URL';
/** Action type constant for opening the hamburger menu. */
export const UI_OPEN_HAMBURGER_MENU = 'UI_OPEN_HAMBURGER_MENU';
/** Action type constant for minimizing the window. */
export const UI_WINDOW_MINIMIZE = 'UI_WINDOW_MINIMIZE';
/** Action type constant for closing the window. */
export const UI_WINDOW_CLOSE = 'UI_WINDOW_CLOSE';
/** Action type constant for entering fullscreen. */
export const UI_ENTER_FULLSCREEN = 'UI_ENTER_FULLSCREEN';
/** Action type constant for leaving fullscreen. */
export const UI_LEAVE_FULLSCREEN = 'UI_LEAVE_FULLSCREEN';
/** Action type constant for opening context menus. */
export const UI_CONTEXTMENU_OPEN = 'UI_CONTEXTMENU_OPEN';
/** Action type constant for executing a UI command. */
export const UI_COMMAND_EXEC = 'UI_COMMAND_EXEC';

/** Action contract for setting font size directly. */
export interface UIFontSizeSetAction {
  /** Discriminates this action as `UI_FONT_SIZE_SET`. */
  readonly type: typeof UI_FONT_SIZE_SET;
  /** Font size, in points, to apply. */
  readonly value: number;
}

/** Action contract for increasing font size. */
export interface UIFontSizeIncrAction {
  /** Discriminates this action as `UI_FONT_SIZE_INCR`. */
  readonly type: typeof UI_FONT_SIZE_INCR;
}

/** Action contract for decreasing font size. */
export interface UIFontSizeDecrAction {
  /** Discriminates this action as `UI_FONT_SIZE_DECR`. */
  readonly type: typeof UI_FONT_SIZE_DECR;
}

/** Action contract for resetting font size. */
export interface UIFontSizeResetAction {
  /** Discriminates this action as `UI_FONT_SIZE_RESET`. */
  readonly type: typeof UI_FONT_SIZE_RESET;
}

/** Action contract for setting font smoothing. */
export interface UIFontSmoothingSetAction {
  /** Discriminates this action as `UI_FONT_SMOOTHING_SET`. */
  readonly type: typeof UI_FONT_SMOOTHING_SET;
  /** Font smoothing mode to apply. */
  readonly fontSmoothing: string;
}

/** Action contract for moving left. */
export interface UIMoveLeftAction {
  /** Discriminates this action as `UI_MOVE_LEFT`. */
  readonly type: typeof UI_MOVE_LEFT;
}

/** Action contract for moving right. */
export interface UIMoveRightAction {
  /** Discriminates this action as `UI_MOVE_RIGHT`. */
  readonly type: typeof UI_MOVE_RIGHT;
}

/** Action contract for moving to a tab index. */
export interface UIMoveToAction {
  /** Discriminates this action as `UI_MOVE_TO`. */
  readonly type: typeof UI_MOVE_TO;
}

/** Action contract for focusing the next pane. */
export interface UIMoveNextPaneAction {
  /** Discriminates this action as `UI_MOVE_NEXT_PANE`. */
  readonly type: typeof UI_MOVE_NEXT_PANE;
}

/** Action contract for focusing the previous pane. */
export interface UIMovePrevPaneAction {
  /** Discriminates this action as `UI_MOVE_PREV_PANE`. */
  readonly type: typeof UI_MOVE_PREV_PANE;
}

/** Action contract for opening preferences. */
export interface UIShowPreferencesAction {
  /** Discriminates this action as `UI_SHOW_PREFERENCES`. */
  readonly type: typeof UI_SHOW_PREFERENCES;
}

/** Action contract for moving the window. */
export interface UIWindowMoveAction {
  /** Discriminates this action as `UI_WINDOW_MOVE`. */
  readonly type: typeof UI_WINDOW_MOVE;
}

/** Action contract for maximizing the window. */
export interface UIWindowMaximizeAction {
  /** Discriminates this action as `UI_WINDOW_MAXIMIZE`. */
  readonly type: typeof UI_WINDOW_MAXIMIZE;
}

/** Action contract for unmaximizing the window. */
export interface UIWindowUnmaximizeAction {
  /** Discriminates this action as `UI_WINDOW_UNMAXIMIZE`. */
  readonly type: typeof UI_WINDOW_UNMAXIMIZE;
}

/** Action contract for window geometry updates. */
export interface UIWindowGeometryChangedAction {
  /** Discriminates this action as `UI_WINDOW_GEOMETRY_CHANGED`. */
  readonly type: typeof UI_WINDOW_GEOMETRY_CHANGED;
  /** Whether the window is currently maximized. */
  readonly isMaximized: boolean;
}

/** Action contract for opening a file. */
export interface UIOpenFileAction {
  /** Discriminates this action as `UI_OPEN_FILE`. */
  readonly type: typeof UI_OPEN_FILE;
}

/** Action contract for opening an SSH URL. */
export interface UIOpenSshUrlAction {
  /** Discriminates this action as `UI_OPEN_SSH_URL`. */
  readonly type: typeof UI_OPEN_SSH_URL;
}

/** Action contract for opening the hamburger menu. */
export interface UIOpenHamburgerMenuAction {
  /** Discriminates this action as `UI_OPEN_HAMBURGER_MENU`. */
  readonly type: typeof UI_OPEN_HAMBURGER_MENU;
}

/** Action contract for minimizing the window. */
export interface UIWindowMinimizeAction {
  /** Discriminates this action as `UI_WINDOW_MINIMIZE`. */
  readonly type: typeof UI_WINDOW_MINIMIZE;
}

/** Action contract for closing the window. */
export interface UIWindowCloseAction {
  /** Discriminates this action as `UI_WINDOW_CLOSE`. */
  readonly type: typeof UI_WINDOW_CLOSE;
}

/** Action contract for entering fullscreen mode. */
export interface UIEnterFullscreenAction {
  /** Discriminates this action as `UI_ENTER_FULLSCREEN`. */
  readonly type: typeof UI_ENTER_FULLSCREEN;
}

/** Action contract for leaving fullscreen mode. */
export interface UILeaveFullscreenAction {
  /** Discriminates this action as `UI_LEAVE_FULLSCREEN`. */
  readonly type: typeof UI_LEAVE_FULLSCREEN;
}

/** Action contract for opening context menus. */
export interface UIContextmenuOpenAction {
  /** Discriminates this action as `UI_CONTEXTMENU_OPEN`. */
  readonly type: typeof UI_CONTEXTMENU_OPEN;
}

/** Action contract for executing command palette actions. */
export interface UICommandExecAction {
  /** Discriminates this action as `UI_COMMAND_EXEC`. */
  readonly type: typeof UI_COMMAND_EXEC;
  /** Identifier of the command to execute. */
  readonly command: CommandId;
}

/** Union of every shared UI action contract. */
export type UIActions =
  | UIFontSizeSetAction
  | UIFontSizeIncrAction
  | UIFontSizeDecrAction
  | UIFontSizeResetAction
  | UIFontSmoothingSetAction
  | UIMoveLeftAction
  | UIMoveRightAction
  | UIMoveToAction
  | UIMoveNextPaneAction
  | UIMovePrevPaneAction
  | UIShowPreferencesAction
  | UIWindowMoveAction
  | UIWindowMaximizeAction
  | UIWindowUnmaximizeAction
  | UIWindowGeometryChangedAction
  | UIOpenFileAction
  | UIOpenSshUrlAction
  | UIOpenHamburgerMenuAction
  | UIWindowMinimizeAction
  | UIWindowCloseAction
  | UIEnterFullscreenAction
  | UILeaveFullscreenAction
  | UIContextmenuOpenAction
  | UICommandExecAction;
