/** @file Shared session action constants and action contracts. */
import type {ProfileId, SessionId} from '../types/common';

/** Action type constant for adding a newly created session. */
export const SESSION_ADD = 'SESSION_ADD';
/** Action type constant for resizing a session's terminal viewport. */
export const SESSION_RESIZE = 'SESSION_RESIZE';
/** Action type constant for requesting a new session from the backend. */
export const SESSION_REQUEST = 'SESSION_REQUEST';
/** Action type constant marking that data is pending for a session. */
export const SESSION_ADD_DATA = 'SESSION_ADD_DATA';
/** Action type constant for appending PTY output to a session. */
export const SESSION_PTY_DATA = 'SESSION_PTY_DATA';
/** Action type constant for a backend-triggered PTY exit. */
export const SESSION_PTY_EXIT = 'SESSION_PTY_EXIT';
/** Action type constant for a user-triggered session exit. */
export const SESSION_USER_EXIT = 'SESSION_USER_EXIT';
/** Action type constant for marking a session as active. */
export const SESSION_SET_ACTIVE = 'SESSION_SET_ACTIVE';
/** Action type constant for clearing the active session reference. */
export const SESSION_CLEAR_ACTIVE = 'SESSION_CLEAR_ACTIVE';
/** Action type constant for recording user data updates to session metadata. */
export const SESSION_USER_DATA = 'SESSION_USER_DATA';
/** Action type constant for updating a session's xterm title. */
export const SESSION_SET_XTERM_TITLE = 'SESSION_SET_XTERM_TITLE';
/** Action type constant for updating a session's reported working directory. */
export const SESSION_SET_CWD = 'SESSION_SET_CWD';
/** Action type constant for toggling a session's search UI visibility. */
export const SESSION_SEARCH = 'SESSION_SEARCH';

/** Adds a newly created session to state. */
export interface SessionAddAction {
  /** Discriminates this action as `SESSION_ADD`. */
  readonly type: typeof SESSION_ADD;
  /** Identifier of the session being added. */
  readonly uid: SessionId;
  /** Shell command launched for the session, if known. */
  readonly shell: string | null;
  /** Process ID of the spawned shell, if known. */
  readonly pid: number | null;
  /** Initial terminal column count, if known. */
  readonly cols: number | null;
  /** Initial terminal row count, if known. */
  readonly rows: number | null;
  /** Pane split orientation when the session was created via a split. */
  readonly splitDirection?: 'HORIZONTAL' | 'VERTICAL';
  /** Session that should remain active after this one is added. */
  readonly activeUid: SessionId | null;
  /** Timestamp the session was added. */
  readonly now: number;
  /** Profile used to configure the session. */
  readonly profile: ProfileId;
}

/** Resizes an existing session terminal viewport. */
export interface SessionResizeAction {
  /** Discriminates this action as `SESSION_RESIZE`. */
  readonly type: typeof SESSION_RESIZE;
  /** Identifier of the session being resized. */
  readonly uid: SessionId;
  /** New terminal column count. */
  readonly cols: number;
  /** New terminal row count. */
  readonly rows: number;
  /** Whether the resize targets a standalone (non-tabbed) terminal window. */
  readonly isStandaloneTerm: boolean;
  /** Timestamp the resize occurred. */
  readonly now: number;
}

/** Requests a new session from the backend. */
export interface SessionRequestAction {
  /** Discriminates this action as `SESSION_REQUEST`. */
  readonly type: typeof SESSION_REQUEST;
}

/** Marks that data is pending for a session. */
export interface SessionAddDataAction {
  /** Discriminates this action as `SESSION_ADD_DATA`. */
  readonly type: typeof SESSION_ADD_DATA;
}

/** Appends PTY data for a session. */
export interface SessionPtyDataAction {
  /** Discriminates this action as `SESSION_PTY_DATA`. */
  readonly type: typeof SESSION_PTY_DATA;
  /** Raw PTY output chunk. */
  readonly data: string;
  /** Identifier of the session the data belongs to. */
  readonly uid: SessionId;
  /** Timestamp the data was received. */
  readonly now: number;
}

/** Handles backend PTY exit events for a session. */
export interface SessionPtyExitAction {
  /** Discriminates this action as `SESSION_PTY_EXIT`. */
  readonly type: typeof SESSION_PTY_EXIT;
  /** Identifier of the session whose PTY exited. */
  readonly uid: SessionId;
}

/** Handles user-triggered session exits. */
export interface SessionUserExitAction {
  /** Discriminates this action as `SESSION_USER_EXIT`. */
  readonly type: typeof SESSION_USER_EXIT;
  /** Identifier of the session being closed. */
  readonly uid: SessionId;
}

/** Marks a specific session as active. */
export interface SessionSetActiveAction {
  /** Discriminates this action as `SESSION_SET_ACTIVE`. */
  readonly type: typeof SESSION_SET_ACTIVE;
  /** Identifier of the session to make active. */
  readonly uid: SessionId;
}

/** Clears the currently active session reference. */
export interface SessionClearActiveAction {
  /** Discriminates this action as `SESSION_CLEAR_ACTIVE`. */
  readonly type: typeof SESSION_CLEAR_ACTIVE;
}

/** Records user data updates for session metadata. */
export interface SessionUserDataAction {
  /** Discriminates this action as `SESSION_USER_DATA`. */
  readonly type: typeof SESSION_USER_DATA;
}

/** Updates the xterm title for a session. */
export interface SessionSetXtermTitleAction {
  /** Discriminates this action as `SESSION_SET_XTERM_TITLE`. */
  readonly type: typeof SESSION_SET_XTERM_TITLE;
  /** Identifier of the session whose title changed. */
  readonly uid: SessionId;
  /** New xterm title reported by the shell. */
  readonly title: string;
}

/** Updates the working directory shown for a session. */
export interface SessionSetCwdAction {
  /** Discriminates this action as `SESSION_SET_CWD`. */
  readonly type: typeof SESSION_SET_CWD;
  /** New working directory reported for the session. */
  readonly cwd: string;
}

/** Toggles search UI visibility for a session. */
export interface SessionSearchAction {
  /** Discriminates this action as `SESSION_SEARCH`. */
  readonly type: typeof SESSION_SEARCH;
  /** Identifier of the session the search UI applies to. */
  readonly uid: SessionId;
  /** Whether the search UI should be shown. */
  readonly value: boolean;
}

/** Union of every shared session action contract. */
export type SessionActions =
  | SessionAddAction
  | SessionResizeAction
  | SessionRequestAction
  | SessionAddDataAction
  | SessionPtyDataAction
  | SessionPtyExitAction
  | SessionUserExitAction
  | SessionSetActiveAction
  | SessionClearActiveAction
  | SessionUserDataAction
  | SessionSetXtermTitleAction
  | SessionSetCwdAction
  | SessionSearchAction;
